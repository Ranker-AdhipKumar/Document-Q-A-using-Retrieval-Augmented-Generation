"""
Pydantic schemas shared across the application.
"""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


# ─── File Search / RAG ───────────────────────────────────────────────────────

class DocumentRecord(BaseModel):
    """A document stored in SQLite for persistence."""
    id: int
    filename: str
    gemini_file_name: str        # e.g. "files/abc123"
    display_name: str
    file_search_doc_name: str    # e.g. "fileSearchStores/.../documents/..."
    uploaded_at: str             # ISO-8601


class UploadResponse(BaseModel):
    document: DocumentRecord
    graph_nodes: int
    graph_edges: int
    message: str


# ─── Knowledge Graph ─────────────────────────────────────────────────────────

class Entity(BaseModel):
    """An entity extracted from document text."""
    name: str = Field(description="Canonical name of the entity")
    type: str = Field(
        default="concept",
        description=(
            "One of: person, organization, concept, term, event, location, product, other"
        )
    )
    description: str = Field(default="", description="One-sentence description of this entity")

    @classmethod
    def from_dict(cls, data: dict) -> "Entity":
        name = data.get("name") or data.get("entity") or data.get("label") or data.get("id") or ""
        entity_type = data.get("type") or data.get("category") or "concept"
        description = data.get("description") or data.get("desc") or data.get("summary") or ""
        return cls(name=str(name), type=str(entity_type), description=str(description))


class Relation(BaseModel):
    """A directed relationship between two entities."""
    from_entity: str = Field(description="Name of the source entity")
    to_entity: str = Field(description="Name of the target entity")
    label: str = Field(default="related_to", description="Short label for the relationship (e.g. 'causes', 'part_of')")

    @classmethod
    def from_dict(cls, data: dict) -> "Relation":
        src = data.get("from_entity") or data.get("source") or data.get("from") or data.get("head") or ""
        tgt = data.get("to_entity") or data.get("target") or data.get("to") or data.get("tail") or ""
        lbl = data.get("label") or data.get("relation") or data.get("relationship") or data.get("predicate") or "related_to"
        return cls(from_entity=str(src), to_entity=str(tgt), label=str(lbl))


class KnowledgeGraphExtraction(BaseModel):
    """Structured output schema for Gemini entity extraction."""
    entities: list[Entity]
    relations: list[Relation]


class GraphNode(BaseModel):
    id: str
    label: str
    type: str
    description: str
    document_sources: list[str] = []


class GraphEdge(BaseModel):
    source: str
    target: str
    label: str
    weight: float = 1.0


class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    links: list[GraphEdge]


# ─── Chat / QA ───────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str           # "user" or "assistant"
    content: str


class AskRequest(BaseModel):
    question: str
    history: list[ChatMessage] = []


class Citation(BaseModel):
    file_name: str
    source: str          # excerpt or chunk reference


class AskResponse(BaseModel):
    answer: str
    citations: list[Citation]
