import { useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { getFile } from '../api/oracle';

interface RawFileState {
  sourceFile: string;
  project?: string;
  dbContent?: string; // fallback content from database
}

export function RawFile() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as RawFileState | null;

  const [content, setContent] = useState<string | null>(null);
  const [fromDb, setFromDb] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!state?.sourceFile) {
      setLoading(false);
      return;
    }

    async function load() {
      const fileData = await getFile(state!.sourceFile, state!.project);
      if (!fileData.error && fileData.content) {
        setContent(fileData.content);
        setFromDb(false);
      } else if (state!.dbContent) {
        setContent(state!.dbContent);
        setFromDb(true);
      }
      setLoading(false);
    }

    load();
  }, [state]);

  if (!state?.sourceFile) {
    return (
      <div className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-muted mb-4">No file specified</p>
          <button
            onClick={() => navigate(-1)}
            className="text-accent hover:underline bg-transparent border-none cursor-pointer text-sm"
          >
            ← Go back
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center">
        <span className="text-text-muted">Loading...</span>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-muted mb-2">Could not load file</p>
          <p className="text-xs text-text-muted font-mono opacity-70 mb-4">{state.sourceFile}</p>
          <button
            onClick={() => navigate(-1)}
            className="text-accent hover:underline bg-transparent border-none cursor-pointer text-sm"
          >
            ← Go back
          </button>
        </div>
      </div>
    );
  }

  const lines = content.split('\n');

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-bg-primary/95 backdrop-blur border-b border-border px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate(-1)}
            className="text-text-secondary hover:text-accent bg-transparent border-none cursor-pointer text-sm shrink-0 transition-colors duration-200"
          >
            ← Back
          </button>
          <span className="text-sm font-mono text-text-secondary truncate">
            📁 {state.sourceFile}
          </span>
          {fromDb && (
            <span className="text-[11px] text-[#f59e0b] bg-[rgba(245,158,11,0.1)] px-2 py-0.5 rounded shrink-0">
              from database
            </span>
          )}
        </div>
        <span className="text-xs text-text-muted shrink-0">{lines.length} lines</span>
      </div>

      {/* Code content */}
      <pre className="px-6 py-4 overflow-auto text-[13px] font-mono text-text-primary whitespace-pre-wrap break-words m-0 leading-relaxed">
        {lines.map((line, i) => (
          <div key={i} className="flex hover:bg-white/[0.03]">
            <span className="text-text-muted opacity-50 min-w-[50px] pr-4 text-right select-none border-r border-border mr-4 shrink-0">
              {i + 1}
            </span>
            <span className="flex-1">{line || ' '}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
