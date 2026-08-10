// Handoff-path finder for an agent session. Greps the full transcript for
// handoff file paths (…/handoff/<file>.md, e.g. ψ/inbox/handoff/2026-…-bot.md)
// and lists them so the operator can copy a path with one tap — no scrolling the
// chat to hunt for it.
import { useEffect, useState } from 'react';
import { fetchTranscript } from '../../lib/fleet';

// Any non-space token that walks through a `handoff/` segment and ends in .md.
const HANDOFF_RE = /[^\s'"()]*handoff\/[^\s'"()]+\.md/g;

function extractHandoffs(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(HANDOFF_RE)) seen.add(m[0]);
  return [...seen].reverse(); // most-recently-mentioned first
}

export function HandoffMenu({ paneId, onClose }: { paneId: string; onClose: () => void }) {
  const [paths, setPaths] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchTranscript(paneId)
      .then((t) => { if (alive) setPaths(extractHandoffs(t)); })
      .catch((e) => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
  }, [paneId]);

  const copy = async (p: string) => {
    try { await navigator.clipboard.writeText(p); setCopied(p); setTimeout(() => setCopied(null), 1500); }
    catch { /* clipboard blocked */ }
  };
  const base = (p: string) => p.split('/').pop() || p;
  const dir = (p: string) => { const i = p.lastIndexOf('/'); return i >= 0 ? p.slice(0, i + 1) : ''; };

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-[min(640px,96vw)] max-h-[80vh] overflow-auto rounded-xl border border-white/15 bg-[#0c0c12] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold text-[14px] text-white/90">📂 Handoff paths in this session</span>
          <button onClick={onClose} className="text-white/50 hover:text-white/90 text-sm">✕</button>
        </div>
        {err && <p className="text-[12px] text-red-300">⚠ {err}</p>}
        {!err && paths == null && <p className="text-[12px] text-white/40">scanning transcript…</p>}
        {!err && paths != null && paths.length === 0 && (
          <p className="text-[12px] text-white/40">no handoff paths found in this session’s transcript.</p>
        )}
        <div className="flex flex-col gap-1.5">
          {(paths ?? []).map((p) => (
            <div key={p} className="flex items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-white/90 font-mono truncate" title={p}>{base(p)}</div>
                <div className="text-[10px] text-white/40 font-mono truncate" title={p}>{dir(p)}</div>
              </div>
              <button onClick={() => copy(p)}
                className="shrink-0 px-2 py-1 rounded text-[11px]"
                style={copied === p
                  ? { background: '#4ade8022', color: '#86efac', border: '1px solid #4ade8055' }
                  : { background: '#38bdf822', color: '#7dd3fc', border: '1px solid #38bdf855' }}
                title="copy full path to clipboard">
                {copied === p ? '✓ copied' : '📋 copy'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
