"""
FastAPI application — Document QA System with Knowledge Graph.

Endpoints:
  POST /upload            Upload & index a document
  GET  /documents         List persisted documents
  DELETE /documents/{id}  Remove a document record
  GET  /graph             Get the knowledge graph (nodes + edges)
  POST /graph/reset       Clear the in-memory graph
  POST /ask               Stream a RAG answer (SSE)
  GET  /health            Health check
"""
from __future__ import annotations

import logging
import os
import shutil
import tempfile
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse

import db
import graph as kg
import rag
from models import AskRequest, DocumentRecord, GraphResponse, UploadResponse

# ─── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ─── App ─────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Document QA System",
    description="RAG-powered document question answering with auto knowledge graph",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:4173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Allowed file extensions
ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".docx", ".rst", ".text"}


# ─── Startup ──────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup_event():
    db.init_db()
    logger.info("Database initialized.")

    # Warm up the Gemini client (validates API key)
    try:
        store_name = rag.get_or_create_store()
        logger.info("File Search store ready: %s", store_name)
    except Exception as e:
        logger.error("Failed to initialize File Search store: %s", e)
        logger.error(
            "Make sure GEMINI_API_KEY is set correctly in backend/.env"
        )


# ─── Root ─────────────────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {
        "name": "Document QA System API",
        "status": "online",
        "docs_url": "http://localhost:8080/docs",
        "frontend_url": "http://localhost:5173",
        "endpoints": {
            "upload": "POST /upload",
            "documents": "GET /documents",
            "graph": "GET /graph",
            "ask": "POST /ask",
            "health": "GET /health"
        }
    }


# ─── Health ───────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    store_name = db.get_setting(rag.STORE_NAME_KEY)
    stats = kg.graph_stats()
    return {
        "status": "ok",
        "file_search_store": store_name,
        "graph": stats,
        "documents": len(db.list_documents()),
    }


# ─── Upload ───────────────────────────────────────────────────────────────────
@app.post("/upload", response_model=UploadResponse)
async def upload_document(file: UploadFile = File(...)):
    """
    Upload a document (PDF, DOCX, TXT, MD).

    Steps:
      1. Save to a temp file.
      2. Extract text for knowledge graph.
      3. Upload to Gemini File Search store & wait for indexing.
      4. Run entity extraction → merge into graph.
      5. Persist document record to SQLite.
    """
    filename = file.filename or "document"
    ext = Path(filename).suffix.lower()

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    # Save upload to temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        # 1. Extract text for knowledge graph
        logger.info("Extracting text from '%s'…", filename)
        text = kg.extract_text(tmp_path, filename)

        # 2. Get/create File Search store
        store_name = rag.get_or_create_store()

        # 3. Upload and index
        doc_name = rag.upload_and_index(tmp_path, filename, store_name)

        # 4. Entity extraction → merge into graph
        logger.info("Extracting entities for knowledge graph…")
        extraction = kg.extract_entities_from_text(text, filename)
        kg.merge_into_graph(extraction, filename)

        # 5. Persist to SQLite
        record = db.save_document(
            filename=filename,
            gemini_file_name="",          # file was uploaded directly to store
            display_name=filename,
            file_search_doc_name=doc_name,
        )

        stats = kg.graph_stats()
        return UploadResponse(
            document=record,
            graph_nodes=stats["nodes"],
            graph_edges=stats["edges"],
            message=f"'{filename}' indexed successfully. Graph has {stats['nodes']} nodes.",
        )

    finally:
        os.unlink(tmp_path)


# ─── Documents ────────────────────────────────────────────────────────────────
@app.get("/documents", response_model=list[DocumentRecord])
async def list_documents():
    return db.list_documents()


@app.delete("/documents/{doc_id}")
async def delete_document(doc_id: int):
    deleted = db.delete_document_by_id(doc_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"message": f"Document {doc_id} removed from history"}


# ─── Knowledge Graph ──────────────────────────────────────────────────────────
@app.get("/graph", response_model=GraphResponse)
async def get_graph():
    return kg.get_graph_response()


@app.post("/graph/reset")
async def reset_graph():
    kg.reset_graph()
    return {"message": "Knowledge graph cleared"}


# ─── Ask (streaming SSE) ──────────────────────────────────────────────────────
@app.post("/ask")
async def ask(request: AskRequest):
    """
    Stream a RAG answer via Server-Sent Events.

    Each SSE event is a JSON object with a 'type' field:
      {"type": "text",      "content": "<token>"}
      {"type": "citations", "citations": [...]}
      {"type": "done"}
      {"type": "error",     "message": "<msg>"}
    """
    store_name = db.get_setting(rag.STORE_NAME_KEY)
    if not store_name:
        raise HTTPException(
            status_code=503,
            detail="File Search store not initialized. Upload a document first.",
        )

    docs = db.list_documents()
    if not docs:
        raise HTTPException(
            status_code=503,
            detail="No documents indexed yet. Upload at least one document.",
        )

    async def event_generator():
        import json
        try:
            async for chunk in rag.ask_question_stream(
                question=request.question,
                store_name=store_name,
                history=request.history,
            ):
                yield chunk
        except Exception as e:
            logger.error("Streaming error: %s", e)
            yield "data: " + json.dumps({"type": "error", "message": str(e)}) + "\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
