// Staging-env lock control. Shows who holds the lock (and whether their pane is
// still alive on the map), lets the owner force-release it, and toggles the
// global "disabled" mode — disabled = behaves exactly like before any lock
// existed (no locking at all).
import { useState } from 'react';
import type { FleetAgent } from '../../lib/fleet';
import type { LockState } from '../../lib/lock';
import { releaseLock, disableLock, enableLock } from '../../lib/lock';

function since(epoch: number): string {
  if (!epoch) return '';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Bangkok',
  }).format(new Date(epoch * 1000));
}

export function LockPanel(
  { lock, agents, onClose, onChange }:
  { lock: LockState | null; agents: FleetAgent[]; onClose: () => void; onChange: (l: LockState) => void },
) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = (fn: () => Promise<LockState>) => {
    setBusy(true); setErr(null);
    fn().then(onChange).catch((e) => setErr((e as Error).message)).finally(() => setBusy(false));
  };

  const holder = lock?.holder;
  const alive = holder?.tmux_pane ? agents.some((a) => a.paneId === holder.tmux_pane) : false;

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-[min(440px,94vw)] rounded-xl border border-white/15 bg-[#0c0c12] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-[14px] text-white/90">🔒 Staging env lock</span>
          <button onClick={onClose} className="text-white/50 hover:text-white/90 text-sm">✕</button>
        </div>
        <p className="text-[11px] text-white/40 mb-3">Only one agent may drive the shared staging env (sinuw) at a time — the live-tester journeys A/B/C/D take this lock before running.</p>

        {!lock && <p className="text-[12px] text-white/40 py-4 text-center">loading…</p>}

        {lock?.disabled && (
          <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-[12px] text-amber-200/90">
            Lock is <b>DISABLED</b> — no locking; agents run as before the mechanism existed.
          </div>
        )}

        {lock && !lock.disabled && !lock.locked && (
          <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/5 p-3 text-[12px] text-emerald-200/90">
            Lock is <b>FREE</b> — the env is available.
          </div>
        )}

        {lock?.locked && holder && (
          <div className="rounded-lg border border-white/10 p-3 text-[12px] text-white/80">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-semibold text-white/95">{holder.agent}</span>
              {holder.campaign && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#c084fc22', color: '#d9bbff', border: '1px solid #c084fc55' }}>{holder.campaign}</span>}
              <span className="text-[10px] px-1.5 py-0.5 rounded ml-auto"
                style={alive ? { background: '#4ade8022', color: '#4ade80', border: '1px solid #4ade8055' } : { background: '#f8717122', color: '#fca5a5', border: '1px solid #f8717155' }}>
                {alive ? `● pane ${holder.tmux_pane} alive` : `▲ pane ${holder.tmux_pane || '?'} not on map`}
              </span>
            </div>
            {holder.reason && <p className="text-white/60 mt-1.5">{holder.reason}</p>}
            <p className="text-[10px] text-white/35 mt-1">held since {since(holder.acquired_epoch)} · {holder.worktree.split('/').pop()}</p>
          </div>
        )}

        {err && <p className="text-[11px] text-red-300 mt-2">{err}</p>}

        <div className="flex items-center gap-2 mt-3">
          {lock?.locked && (
            <button disabled={busy} onClick={() => run(releaseLock)}
              className="px-3 py-1.5 rounded-lg text-[12px] disabled:opacity-40"
              style={{ background: '#f8717122', color: '#fca5a5', border: '1px solid #f8717155' }}>
              Release lock
            </button>
          )}
          {lock && (lock.disabled
            ? <button disabled={busy} onClick={() => run(enableLock)} className="ml-auto px-3 py-1.5 rounded-lg text-[12px] disabled:opacity-40" style={{ background: '#4ade8022', color: '#4ade80', border: '1px solid #4ade8055' }}>Enable locking</button>
            : <button disabled={busy} onClick={() => run(disableLock)} className="ml-auto px-3 py-1.5 rounded-lg text-[12px] disabled:opacity-40" style={{ background: '#ffffff10', color: '#cbd5e1', border: '1px solid #ffffff22' }}>Disable lock (no-lock mode)</button>
          )}
        </div>
      </div>
    </div>
  );
}
