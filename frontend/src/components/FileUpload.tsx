import { useState, useRef, useCallback } from "react";
import {
  uploadDocument,
  listDocuments,
  deleteDocument,
} from "../api";
import type { DocumentRecord } from "../api";
import "./FileUpload.css";

interface Props {
  onDocumentUploaded: () => void;
}

type UploadState = "idle" | "uploading" | "indexing" | "done" | "error";

export default function FileUpload({ onDocumentUploaded }: Props) {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadMsg, setUploadMsg] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshDocs = useCallback(async () => {
    try {
      const list = await listDocuments();
      setDocs(list);
    } catch {
      // silently ignore
    }
  }, []);

  // Load on first render
  useState(() => {
    refreshDocs();
  });

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      setUploadState("uploading");
      setUploadMsg(`Uploading "${file.name}"…`);
      try {
        setUploadState("indexing");
        setUploadMsg(`Indexing "${file.name}" — this may take ~30 s…`);
        const resp = await uploadDocument(file);
        setUploadState("done");
        setUploadMsg(resp.message);
        await refreshDocs();
        onDocumentUploaded();
        setTimeout(() => {
          setUploadState("idle");
          setUploadMsg("");
        }, 4000);
      } catch (e: any) {
        setUploadState("error");
        setUploadMsg(e.message ?? "Upload failed");
      }
    },
    [refreshDocs, onDocumentUploaded]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const onDelete = useCallback(
    async (id: number) => {
      await deleteDocument(id);
      await refreshDocs();
    },
    [refreshDocs]
  );

  const stateIcon: Record<UploadState, string> = {
    idle: "📂",
    uploading: "⬆️",
    indexing: "⚙️",
    done: "✅",
    error: "❌",
  };

  return (
    <div className="file-upload">
      {/* Drop zone */}
      <div
        className={`drop-zone ${dragging ? "dragging" : ""} ${uploadState !== "idle" ? "busy" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => uploadState === "idle" && fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".pdf,.txt,.md,.docx,.rst"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {uploadState === "idle" ? (
          <>
            <span className="drop-icon">⬆️</span>
            <p className="drop-label">Drop a file or click to upload</p>
            <p className="drop-hint">PDF · DOCX · TXT · MD</p>
          </>
        ) : uploadState === "error" ? (
          <>
            <span className="drop-icon">{stateIcon.error}</span>
            <p className="drop-label drop-error">{uploadMsg}</p>
            <div className="drop-retry-actions" onClick={(e) => e.stopPropagation()}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setUploadState("idle");
                  setUploadMsg("");
                  fileRef.current?.click();
                }}
              >
                🔄 Try Again
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setUploadState("idle");
                  setUploadMsg("");
                }}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <span className={`drop-icon ${uploadState === "uploading" || uploadState === "indexing" ? "spin" : ""}`}>
              {stateIcon[uploadState]}
            </span>
            <p className="drop-label">{uploadMsg}</p>
          </>
        )}
      </div>

      {/* Document list */}
      <div className="doc-list-header">
        <span>Documents</span>
        <span className="doc-count">{docs.length}</span>
      </div>

      {docs.length === 0 ? (
        <p className="doc-empty">No documents yet</p>
      ) : (
        <ul className="doc-list">
          {docs.map((d) => (
            <li key={d.id} className="doc-item">
              <span className="doc-icon">📄</span>
              <div className="doc-info">
                <span className="doc-name" title={d.filename}>{d.filename}</span>
                <span className="doc-date">
                  {new Date(d.uploaded_at).toLocaleDateString()}
                </span>
              </div>
              <button
                className="btn btn-danger doc-delete"
                title="Remove from history"
                onClick={() => onDelete(d.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
