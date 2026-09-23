# Document QA System with AI Knowledge Graph

A full-stack RAG (Retrieval-Augmented Generation) system for uploading documents and asking questions — powered by **Gemini API**. Answers are grounded in your documents with supporting citations, and an **auto-generated knowledge graph** visually maps all key concepts and relationships.

---

## ✨ Features

| Feature | Detail |
|---|---|
| **Document Upload** | PDF, DOCX, TXT, Markdown — drag & drop |
| **Semantic RAG** | Gemini File Search (managed embedding + vector retrieval) |
| **Streaming Answers** | Token-by-token SSE streaming |
| **Source Citations** | Click citation chips to see verbatim retrieved excerpts |
| **AI Knowledge Graph** | 🆕 Gemini structured output extracts entities & relations → D3.js force graph |
| **Click-to-Ask** | Click any graph node to instantly ask a scoped question |
| **Persistence** | SQLite stores the File Search store + last 20 documents across restarts |
| **DOCX support** | Full Word document → text extraction |

---

## 🚀 Quick Start

### Step 1 — Get a Gemini API Key (free)

1. Go to **https://aistudio.google.com/app/apikey**
2. Sign in with any Google account
3. Click **"Create API key"** → copy the key

### Step 2 — Set up the backend

```powershell
cd doc-qa\backend

# Create & activate a virtual environment
python -m venv .venv
.venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt

# Configure your API key
Copy-Item .env.example .env
# Open .env and paste your key: GEMINI_API_KEY=AIza...

# Start the server
uvicorn main:app --reload --port 8000
```

The backend will be available at **http://localhost:8000**
Interactive API docs: **http://localhost:8000/docs**

### Step 3 — Set up the frontend

```powershell
cd doc-qa\frontend

npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## 📐 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    React + Vite Frontend                    │
│  FileUpload  ──→  ChatPanel (SSE streaming)                 │
│                   KnowledgeGraph (D3.js force graph)        │
│                   SourceDrawer (citation excerpts)          │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST + SSE
┌──────────────────────▼──────────────────────────────────────┐
│                    FastAPI Backend                          │
│  POST /upload   → extract text → index in Gemini File       │
│                   Search Store → extract entities (JSON)    │
│  GET  /graph    → return D3-ready {nodes, links}            │
│  POST /ask      → Gemini interaction + file_search tool     │
│                   → stream SSE tokens + citations           │
│  GET  /documents → list persisted documents (SQLite)        │
└──────────────────────┬──────────────────────────────────────┘
                       │ google-genai SDK
┌──────────────────────▼──────────────────────────────────────┐
│                  Gemini API                                 │
│  File Search Store  (gemini-embedding-2)                    │
│  Interactions API   (gemini-3.8-flash + file_search tool)   │
│  Structured Output  (entity / relation extraction)          │
└─────────────────────────────────────────────────────────────┘
```

---

## 🧠 Novel Feature: Auto-Generated Knowledge Graph

When you upload a document, Gemini is called with **structured JSON output** (Pydantic schema) to extract:

- **Entities** — people, organizations, concepts, terms, events (up to 25 per document)
- **Relations** — semantic links between entity pairs (up to 35 per document)

These accumulate in a **NetworkX DiGraph** across all uploaded documents. When multiple documents reference the same concept, that node grows larger, and its edges reflect cross-document co-citation.

The graph is rendered as a **D3.js force-directed diagram** where:
- 🟢 **Node color** = entity type (see legend in the UI)
- 🔗 **Edge thickness** = relationship weight / frequency
- 🖱️ **Click a node** → pre-fills the chat: *"Explain 'concept' based on the documents"*
- 💬 **Hover a node** → tooltip with description + which documents mention it

---

## 📁 Project Structure

```
doc-qa/
├── backend/
│   ├── main.py          # FastAPI endpoints
│   ├── rag.py           # Gemini File Search RAG
│   ├── graph.py         # Entity extraction + NetworkX + D3 serialization
│   ├── db.py            # SQLite persistence
│   ├── models.py        # Pydantic schemas
│   ├── requirements.txt
│   └── .env.example     # ← copy to .env and add your key
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── api.ts           # Typed API client + SSE
│       └── components/
│           ├── FileUpload.tsx
│           ├── ChatPanel.tsx
│           ├── KnowledgeGraph.tsx  # D3.js force graph
│           └── SourceDrawer.tsx
└── README.md
```

---

## 🔧 Configuration

All settings live in `backend/.env`:

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | *(required)* | Your Gemini API key |
| `DB_PATH` | `./doc_qa.db` | SQLite database path |
| `MAX_PERSISTED_DOCS` | `20` | Rolling document history limit (0 = unlimited) |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Model for QA + entity extraction |
| `EMBEDDING_MODEL` | `models/gemini-embedding-2` | Embedding model for File Search store |

---

## 🔌 API Reference

| Method | Path | Description |
|---|---|---|
| `POST` | `/upload` | Upload + index a document |
| `GET` | `/documents` | List persisted documents |
| `DELETE` | `/documents/{id}` | Remove a document record |
| `GET` | `/graph` | Get knowledge graph (nodes + edges) |
| `POST` | `/graph/reset` | Clear the in-memory graph |
| `POST` | `/ask` | Stream a RAG answer (SSE) |
| `GET` | `/health` | Health check |

Full interactive docs at **http://localhost:8000/docs** when the server is running.
