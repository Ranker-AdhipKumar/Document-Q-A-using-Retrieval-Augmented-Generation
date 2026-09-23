import type { Citation } from "../api";
import "./SourceDrawer.css";

interface Props {
  citations: Citation[];
  onClose: () => void;
}

export default function SourceDrawer({ citations, onClose }: Props) {
  return (
    <>
      {/* Backdrop */}
      <div className="drawer-backdrop" onClick={onClose} />

      <div className="drawer">
        <div className="drawer-header">
          <h3 className="drawer-title">📎 Sources & References</h3>
          <button className="btn btn-ghost drawer-close" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-body">
          {citations.length === 0 ? (
            <p className="drawer-empty">No citations available for this answer.</p>
          ) : (
            <ul className="source-list">
              {citations.map((c, i) => (
                <li key={i} className="source-item">
                  <div className="source-header">
                    <span className="source-icon">📄</span>
                    <span className="source-filename">{c.file_name}</span>
                    <span className="source-index">#{i + 1}</span>
                  </div>
                  {c.source && (
                    <blockquote className="source-excerpt">
                      {c.source}
                    </blockquote>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
