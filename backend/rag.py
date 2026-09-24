"""
Gemini File Search RAG integration.

Responsibilities:
  - Create (or reuse persisted) a File Search store.
  - Upload documents and poll until indexed.
  - Answer questions using the file_search tool and parse citations.
"""
from __future__ import annotations

import os
import time
import logging
from typing import AsyncGenerator

from google import genai

import db
from models import AskResponse, Citation, ChatMessage

logger = logging.getLogger(__name__)

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "models/gemini-embedding-2")
STORE_NAME_KEY = "file_search_store_name"

def get_candidate_models() -> list[str]:
    primary = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
    fallback = ["gemini-3.5-flash-lite", "gemini-flash-latest", "gemini-3.8-flash"]
    candidates = [primary] + [m for m in fallback if m != primary]
    return candidates

_client: genai.Client | None = None


def get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client()
    return _client


# ─── File Search Store ────────────────────────────────────────────────────────

def get_or_create_store() -> str:
    """Return the persisted store name if accessible with current key, or create a new one."""
    client = get_client()
    stored = db.get_setting(STORE_NAME_KEY)
    if stored:
        try:
            client.file_search_stores.get(name=stored)
            logger.info("Reusing verified File Search store: %s", stored)
            return stored
        except Exception as e:
            logger.warning(
                "Stored store '%s' is not accessible with the current API key (%s). Creating a fresh store.",
                stored,
                e,
            )

    store = client.file_search_stores.create(
        config={
            "display_name": "doc-qa-store",
            "embedding_model": EMBEDDING_MODEL,
        }
    )
    db.set_setting(STORE_NAME_KEY, store.name)
    logger.info("Created new File Search store: %s", store.name)
    return store.name


# ─── Document Upload ──────────────────────────────────────────────────────────

def upload_and_index(file_path: str, display_name: str, store_name: str) -> str:
    """
    Upload a file to the File Search store and block until indexing completes.
    Returns the file_search_doc_name (e.g. fileSearchStores/.../documents/...).
    """
    client = get_client()

    logger.info("Uploading '%s' to File Search store…", display_name)
    operation = client.file_search_stores.upload_to_file_search_store(
        file=file_path,
        file_search_store_name=store_name,
        config={
            "display_name": display_name,
            "chunking_config": {
                "white_space_config": {
                    "max_tokens_per_chunk": 400,
                    "max_overlap_tokens": 40,
                }
            },
        },
    )

    # Poll until done
    poll_interval = 3
    for attempt in range(120):  # up to ~6 min
        if operation.done:
            break
        time.sleep(poll_interval)
        operation = client.operations.get(operation)
        logger.debug("Indexing attempt %d — done=%s", attempt + 1, operation.done)

    if not operation.done:
        raise TimeoutError(f"Indexing timed out for '{display_name}'")

    # operation.name IS the document resource name after completion
    # e.g. "fileSearchStores/xxx/documents/yyy"
    doc_name = operation.name if operation.name else f"{store_name}/documents/unknown"
    logger.info("Indexed → %s", doc_name)
    return doc_name


# ─── Question Answering ───────────────────────────────────────────────────────

def ask_question(
    question: str,
    store_name: str,
    history: list[ChatMessage] | None = None,
) -> AskResponse:
    """
    Run a single-turn (or multi-turn) RAG query against the file search store.
    Returns the answer text plus citations.
    """
    client = get_client()

    # Build previous_interaction_id chain from history if we had it,
    # but since we only have text history here, we embed it in the system prompt
    history_text = ""
    if history:
        for msg in history[-6:]:  # keep last 3 turns
            role = "User" if msg.role == "user" else "Assistant"
            history_text += f"{role}: {msg.content}\n"

    system_instruction = (
        "You are a precise document analyst. Answer questions using ONLY the "
        "information in the provided documents. If you cannot find the answer, "
        "say so clearly. Always cite specific sections or documents.\n\n"
        "Conversation so far:\n" + history_text
        if history_text
        else "You are a precise document analyst. Answer questions using ONLY the "
             "information in the provided documents. If you cannot find the answer, "
             "say so clearly. Always cite specific sections or documents."
    )

    for model_name in get_candidate_models():
        try:
            interaction = client.interactions.create(
                model=model_name,
                input=question,
                system_instruction=system_instruction,
                tools=[
                    {
                        "type": "file_search",
                        "file_search_store_names": [store_name],
                    }
                ],
            )

            # Extract answer text and citations
            answer_parts: list[str] = []
            citations: list[Citation] = []

            for step in getattr(interaction, "steps", []):
                if step.type == "model_output":
                    for content_block in step.content:
                        if content_block.type == "text":
                            answer_parts.append(content_block.text)
                            if content_block.annotations:
                                for ann in content_block.annotations:
                                    if ann.type == "file_citation":
                                        citations.append(
                                            Citation(
                                                file_name=getattr(ann, "file_name", "Unknown"),
                                                source=getattr(ann, "source", ""),
                                            )
                                        )

            # Deduplicate citations
            seen = set()
            unique_citations: list[Citation] = []
            for c in citations:
                key = (c.file_name, c.source[:80])
                if key not in seen:
                    seen.add(key)
                    unique_citations.append(c)

            return AskResponse(
                answer="".join(answer_parts),
                citations=unique_citations,
            )
        except Exception as e:
            logger.warning("ask_question with %s failed: %s. Trying fallback model...", model_name, e)
            continue

    return AskResponse(
        answer="The AI service is experiencing high demand. Please try asking again shortly.",
        citations=[],
    )


async def ask_question_stream(
    question: str,
    store_name: str,
    history: list[ChatMessage] | None = None,
) -> AsyncGenerator[str, None]:
    """
    Streaming version — yields Server-Sent Event lines.
    Yields: data: <json-line>\n\n
    """
    import json

    client = get_client()

    history_text = ""
    if history:
        for msg in (history or [])[-6:]:
            role = "User" if msg.role == "user" else "Assistant"
            history_text += f"{role}: {msg.content}\n"

    system_instruction = (
        "You are a precise document analyst. Answer questions using ONLY the "
        "information in the provided documents. If you cannot find the answer, "
        "say so clearly. Always cite specific sections or documents.\n\n"
        + ("Conversation so far:\n" + history_text if history_text else "")
    )

    citations: list[Citation] = []
    models_to_try = get_candidate_models()

    for model_name in models_to_try:
        try:
            logger.info("Attempting streaming QA with model '%s'...", model_name)
            stream = client.interactions.create(
                model=model_name,
                input=question,
                system_instruction=system_instruction,
                tools=[
                    {
                        "type": "file_search",
                        "file_search_store_names": [store_name],
                    }
                ],
                stream=True,
            )

            streamed_any = False
            for event in stream:
                if event.event_type == "error":
                    err = getattr(event, "error", "Stream error")
                    raise RuntimeError(f"Model {model_name} error: {err}")

                elif event.event_type == "step.delta":
                    delta = event.delta
                    if getattr(delta, "type", None) == "text" and delta.text:
                        streamed_any = True
                        yield "data: " + json.dumps({"type": "text", "content": delta.text}) + "\n\n"

                elif event.event_type == "interaction.completed":
                    for step in getattr(event.interaction, "steps", []):
                        if step.type == "model_output":
                            for cb in step.content:
                                if cb.type == "text" and cb.annotations:
                                    for ann in cb.annotations:
                                        if ann.type == "file_citation":
                                            citations.append(
                                                Citation(
                                                    file_name=getattr(ann, "file_name", "Unknown"),
                                                    source=getattr(ann, "source", ""),
                                                )
                                            )

            # Deduplicate and send citations
            seen: set[tuple] = set()
            unique: list[dict] = []
            for c in citations:
                key = (c.file_name, c.source[:80])
                if key not in seen:
                    seen.add(key)
                    unique.append({"file_name": c.file_name, "source": c.source})

            yield "data: " + json.dumps({"type": "citations", "citations": unique}) + "\n\n"
            yield "data: " + json.dumps({"type": "done"}) + "\n\n"
            return

        except Exception as e:
            logger.warning("Streaming with model '%s' failed: %s. Trying fallback model...", model_name, e)
            continue

    # If all candidate models failed
    yield "data: " + json.dumps({"type": "error", "message": "The AI service is experiencing high demand. Please try asking again in a few moments."}) + "\n\n"
