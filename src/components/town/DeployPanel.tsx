// Staging deploy panel. Pick a slice (full / UI-only), optionally dry-run or
// pull main first, hit Deploy → the gateway's deploy-staging.sh runs from the
// PRIMARY checkout (never a worktree) and its output streams here so you can see
// errors live. A separate button fetch+pulls main on both repos (gateway + UI).
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useDeploy, startDeploy, pullMain, cancelDeploy, type DeployMode } from '../../lib/deploy';

function Btn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="px-2.5 py-1 rounded text-[12px]"
      style={active ? { background: '#38bdf822', color: '#7dd3fc', border: '1px solid #38bdf866' }
        : { background: '#ffffff08', color: '#aaa', border: '1px solid #ffffff14' }}>{children}</button>
  );
}

export function DeployPanel({ onClose }: { onClose: () => void }) {
  const { run, reload } = useDeploy(true);
  const [mode, setMode] = useState<DeployMode>('full');
  const [dry, setDry] = useState(true);   // default to the safe plan-only path
  const [pull, setPull] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const running = run?.status === 'running';

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [run?.log]);

  const fire = async (fn: () => Promise<{ error?: string }>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setMsg(null);
    const r = await fn();
    if (r.error) setMsg(r.error); else reload();
  };

  const deploy = () => fire(
    () => startDeploy(mode, dry, pull),
    dry ? undefined
      : `LIVE ${mode === 'ui' ? 'UI-only ' : 'full '}deploy to STAGING${pull ? ' (pulls main first)' : ''}. This mutates staging. Continue?`,
  );

  return (
    <div className="fixed inset-0 z-[56] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-[min(680px,96vw)] max-h-[92vh] overflow-auto rounded-xl border border-white/15 bg-[#0c0c12] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-[14px] text-white/90">🚀 Deploy staging</span>
          <button onClick={onClose} className="text-white/50 hover:text-white/90 text-sm">✕</button>
        </div>
        <p className="text-[11px] text-white/40 mb-3">
          Runs <code className="text-sky-300">deploy-staging.sh</code> from the <b>primary</b> gateway checkout (never a worktree). Output streams below.
        </p>

        {/* which slice */}
        <div className="rounded-lg border border-white/10 p-2.5 mb-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/40 w-16">Slice</span>
            <Btn active={mode === 'full'} onClick={() => setMode('full')}>Full stack</Btn>
            <Btn active={mode === 'ui'} onClick={() => setMode('ui')}>UI only (portal)</Btn>
          </div>
          <div className="flex flex-wrap items-center gap-4 pl-[72px]">
            <label className="flex items-center gap-1.5 text-[11px] text-white/70" title="Plan + stage only — runs the gate informationally and mutates nothing.">
              <input type="checkbox" checked={dry} onChange={(e) => setDry(e.target.checked)} /> Dry-run (plan only)
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-white/70" title="git fetch + checkout main + ff-pull before deploying.">
              <input type="checkbox" checked={pull} onChange={(e) => setPull(e.target.checked)} /> Pull main first
            </label>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => fire(pullMain)} disabled={running}
            className="px-3 py-1.5 rounded-lg text-[12px] disabled:opacity-40"
            style={{ background: '#a78bfa22', color: '#c4b5fd', border: '1px solid #a78bfa55' }}
            title="git fetch origin main + checkout main + pull --ff-only on gateway AND admin-portal">
            ⤓ Fetch &amp; pull main (both repos)
          </button>
          {!running
            ? <button onClick={deploy} className="ml-auto px-3 py-1.5 rounded-lg text-[12px]"
                style={dry ? { background: '#38bdf822', color: '#7dd3fc', border: '1px solid #38bdf855' }
                  : { background: '#f59e0b22', color: '#fbbf24', border: '1px solid #f59e0b66' }}>
                {dry ? '🔍 Dry-run' : '🚀 Deploy'} {mode === 'ui' ? 'UI' : 'full'}
              </button>
            : <button onClick={() => cancelDeploy()} className="ml-auto px-3 py-1.5 rounded-lg text-[12px]"
                style={{ background: '#f8717122', color: '#fca5a5', border: '1px solid #f8717155' }}>■ Cancel</button>}
        </div>
        {msg && <p className="text-[11px] text-amber-300 mb-2">{msg}</p>}

        {/* streamed output */}
        {run && run.status !== 'idle' && (
          <div className="rounded-lg border border-white/10 p-2">
            <div className="flex items-center gap-2 text-[11px] mb-1">
              <span className="font-mono" style={{ color: running ? '#fbbf24' : run.exitCode === 0 ? '#4ade80' : '#f87171' }}>
                ● {run.status}{run.exitCode != null ? ` (exit ${run.exitCode})` : ''}
              </span>
              {run.action && <span className="text-white/40 truncate">{run.action}</span>}
            </div>
            <pre ref={logRef} className="text-[10px] text-white/60 font-mono mt-1 max-h-72 overflow-auto whitespace-pre-wrap">{(run.log || []).join('\n')}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
