/**
 * Typed API client for the FastAPI backend.
 * Handles REST calls + SSE streaming for /ask.
 */

const BASE = (import.meta as any).env?.VITE_API_BASE_URL ||
  (typeof window !== "undefined" && window.location.port === "5173" ? "http://localhost:8080" : "");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DocumentRecord {
  id: number;
  filename: string;
  gemini_file_name: string;
  display_name: string;
  file_search_doc_name: string;
  uploaded_at: string;
}

export interface UploadResponse {
  document: DocumentRecord;
  graph_nodes: number;
  graph_edges: number;
  message: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  description: string;
  document_sources: string[];
  // D3 simulation adds these at runtime:
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  label: string;
  weight: number;
}

export interface GraphResponse {
  nodes: GraphNode[];
  links: GraphEdge[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Citation {
  file_name: string;
  source: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

export async function uploadDocument(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  return request<UploadResponse>("/upload", { method: "POST", body: form });
}

export async function listDocuments(): Promise<DocumentRecord[]> {
  return request<DocumentRecord[]>("/documents");
}

export async function deleteDocument(id: number): Promise<void> {
  await request(`/documents/${id}`, { method: "DELETE" });
}

export async function getGraph(): Promise<GraphResponse> {
  return request<GraphResponse>("/graph");
}

export async function resetGraph(): Promise<void> {
  await request("/graph/reset", { method: "POST" });
}

export interface StreamCallbacks {
  onToken: (text: string) => void;
  onCitations: (citations: Citation[]) => void;
  onDone: () => void;
  onError: (msg: string) => void;
}

/**
 * Stream a RAG answer via SSE.
 * Returns an AbortController so the caller can cancel mid-stream.
 */
export function askStream(
  question: string,
  history: ChatMessage[],
  callbacks: StreamCallbacks
): AbortController {
  const controller = new AbortController();

  fetch(`${BASE}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text();
        callbacks.onError(`${res.status}: ${body}`);
        return;
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE lines are separated by "\n\n"
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          const line = event.replace(/^data: /, "").trim();
          if (!line) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === "text") callbacks.onToken(msg.content);
            else if (msg.type === "citations") callbacks.onCitations(msg.citations);
            else if (msg.type === "done") callbacks.onDone();
            else if (msg.type === "error") callbacks.onError(msg.message);
          } catch {
            // ignore malformed lines
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        callbacks.onError(String(err));
      }
    });

  return controller;
}
