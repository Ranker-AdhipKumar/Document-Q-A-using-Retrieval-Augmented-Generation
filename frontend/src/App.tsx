import { useState, useCallback } from "react";
import FileUpload from "./components/FileUpload";
import ChatPanel from "./components/ChatPanel";
import KnowledgeGraph from "./components/KnowledgeGraph";
import "./App.css";

export default function App() {
  const [graphVersion, setGraphVersion] = useState(0);
  const [prefillQuery, setPrefillQuery] = useState<string | null>(null);

  const handleDocumentUploaded = useCallback(() => {
    setGraphVersion((v) => v + 1);
  }, []);

  const handleNodeClick = useCallback((conceptName: string) => {
    setPrefillQuery(`Explain "${conceptName}" based on the documents`);
  }, []);

  const handleQueryConsumed = useCallback(() => {
    setPrefillQuery(null);
  }, []);

  return (
    <div className="app-root">
      {/* ── Left sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-icon">📄</span>
          <span className="logo-text">DocQA</span>
        </div>
        <FileUpload onDocumentUploaded={handleDocumentUploaded} />
      </aside>

      {/* ── Centre: Chat ── */}
      <main className="chat-area">
        <ChatPanel
          prefillQuery={prefillQuery}
          onQueryConsumed={handleQueryConsumed}
        />
      </main>

      {/* ── Right: Knowledge Graph ── */}
      <aside className="graph-area">
        <KnowledgeGraph
          version={graphVersion}
          onNodeClick={handleNodeClick}
        />
      </aside>
    </div>
  );
}
