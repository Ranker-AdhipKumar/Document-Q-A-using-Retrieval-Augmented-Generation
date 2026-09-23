"""
SQLite persistence layer.

Stores:
  - The active Gemini File Search store name (survives server restarts).
  - A rolling history of the last MAX_PERSISTED_DOCS uploaded documents.
"""
from __future__ import annotations

import sqlite3
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Optional

from models import DocumentRecord

DB_PATH = os.getenv("DB_PATH", "./doc_qa.db")
MAX_PERSISTED_DOCS = int(os.getenv("MAX_PERSISTED_DOCS", "20"))


# ─── Connection helper ────────────────────────────────────────────────────────

@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


# ─── Schema bootstrap ─────────────────────────────────────────────────────────

def init_db() -> None:
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS documents (
                id                    INTEGER PRIMARY KEY AUTOINCREMENT,
                filename              TEXT NOT NULL,
                gemini_file_name      TEXT NOT NULL,
                display_name          TEXT NOT NULL,
                file_search_doc_name  TEXT NOT NULL,
                uploaded_at           TEXT NOT NULL
            );
        """)


# ─── Settings (file search store name) ───────────────────────────────────────

def get_setting(key: str) -> Optional[str]:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT value FROM settings WHERE key = ?", (key,)
        ).fetchone()
        return row["value"] if row else None


def set_setting(key: str, value: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, value),
        )


# ─── Documents ───────────────────────────────────────────────────────────────

def save_document(
    filename: str,
    gemini_file_name: str,
    display_name: str,
    file_search_doc_name: str,
) -> DocumentRecord:
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO documents
              (filename, gemini_file_name, display_name, file_search_doc_name, uploaded_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (filename, gemini_file_name, display_name, file_search_doc_name, now),
        )
        doc_id = cur.lastrowid

        # Enforce rolling window — delete oldest rows beyond MAX_PERSISTED_DOCS
        if MAX_PERSISTED_DOCS > 0:
            conn.execute(
                """
                DELETE FROM documents
                WHERE id NOT IN (
                    SELECT id FROM documents ORDER BY id DESC LIMIT ?
                )
                """,
                (MAX_PERSISTED_DOCS,),
            )

    return DocumentRecord(
        id=doc_id,
        filename=filename,
        gemini_file_name=gemini_file_name,
        display_name=display_name,
        file_search_doc_name=file_search_doc_name,
        uploaded_at=now,
    )


def list_documents() -> list[DocumentRecord]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM documents ORDER BY id DESC"
        ).fetchall()
        return [
            DocumentRecord(
                id=r["id"],
                filename=r["filename"],
                gemini_file_name=r["gemini_file_name"],
                display_name=r["display_name"],
                file_search_doc_name=r["file_search_doc_name"],
                uploaded_at=r["uploaded_at"],
            )
            for r in rows
        ]


def delete_document_by_id(doc_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        return cur.rowcount > 0
