// Past live-test runs for the panel — read from ~/.fleet-town/livetest-history.jsonl
// via the server, most-recent-first, with clear GMT+7 timestamps + duration, the
// green/amber/red rollup, exit code, and the evidence path.
import { useEffect, useState } from 'react';
import { getHistory, bkk, type HistoryEntry } from '../../lib/livetest';

const dur = (a: number, b: number) => {
  const s = Math.max(0, Math.round((b - a) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
};

export function LiveTestHistory() {
  const [h, setH] = useState<HistoryEntry[] | null>(null);
  const load = () => getHistory(50).then(setH).catch(() => setH([]));
  useEffect(() => { load(); }, []);
  if (!h) return <div className="text-[11px] text-white/40 px-1 py-2">loading history…</div>;

  return (
    <div className="rounded-lg border border-white/10 p-2 mb-3 space-y-1">
      <div className="flex items-center text-[10px] text-white/40 mb-1">
        <span>past runs (GMT+7)</span>
        <button onClick={load} className="ml-auto text-white/50 hover:text-white/80">↻ refresh</button>
      </div>
      {!h.length && <div className="text-[11px] text-white/40">no runs recorded yet.</div>}
      {h.map((e) => (
        <div key={e.id + e.startedAt} className="flex items-center gap-2 text-[11px] border-t border-white/5 pt-1">
          <span title={e.trigger === 'scheduled' ? 'nightly scheduler' : 'manual'}>{e.trigger === 'scheduled' ? '🌙' : '👤'}</span>
          <span className="font-mono text-white/80 truncate max-w-[150px]" title={`${e.suite}${e.evidenceDir ? `\nevidence: ${e.evidenceDir}` : ''}`}>{e.suite}</span>
          <span className="text-white/45">{bkk(e.startedAt)}</span>
          <span className="text-white/35">{dur(e.startedAt, e.endedAt)}</span>
          <span className="ml-auto flex items-center gap-1.5">
            {e.colors.green > 0 && <span className="text-emerald-400">🟢{e.colors.green}</span>}
            {e.colors.amber > 0 && <span className="text-amber-300">🟡{e.colors.amber}</span>}
            {e.colors.red > 0 && <span className="text-red-400">🔴{e.colors.red}</span>}
            <span style={{ color: e.exitCode === 0 ? '#4ade80' : '#f87171' }}>exit {e.exitCode ?? '—'}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
