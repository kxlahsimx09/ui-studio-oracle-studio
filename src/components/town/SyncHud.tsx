// Top-right staging-sync HUD. Collapsible (state persisted). Shows each substrate
// from verify-staging.sh as a coloured dot — green = in sync / live, red = out of
// sync (STALE) or failing, amber = warn, grey = unknown/skipped. Auto-refreshes
// ~every minute; ⟳ forces a run now.
import { useState } from 'react';
import type { CheckState, VerifyState } from '../../lib/verify';

const DOT: Record<CheckState, string> = {
  ok: '#4ade80', stale: '#f87171', fail: '#f87171', warn: '#fbbf24', unknown: '#64748b', skipped: '#475569',
};
const KEY = 'town-sync-hud-collapsed';

function ago(ts?: number): string {
  if (!ts) return 'never';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

export function SyncHud({ state, refresh, deploying = false }: { state: VerifyState | null; refresh: () => void; deploying?: boolean }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(KEY) === '1');
  const setCol = (v: boolean) => { setCollapsed(v); localStorage.setItem(KEY, v ? '1' : '0'); };

  const running = state?.status === 'running';
  const bad = state?.checks?.some((c) => c.state === 'stale' || c.state === 'fail');
  // overall: red if any substrate out of sync/failing, green if verify passed, grey unknown
  const overall: CheckState = bad ? 'stale' : state?.ok ? 'ok' : 'unknown';
  const shake = deploying ? ' town-hud-shake' : ''; // a deploy in flight is changing this

  if (collapsed) {
    return (
      <button className={`town-hud town-hud-pill${shake}`} onClick={() => setCol(false)} title="show staging sync status">
        <span className="town-hud-dot" style={{ background: DOT[overall], boxShadow: `0 0 6px ${DOT[overall]}` }} />
        sync{deploying ? ' 🚀' : running ? ' …' : ''}
      </button>
    );
  }

  return (
    <div className={`town-hud town-hud-card${shake}`}>
      <div className="town-hud-head">
        <span className="town-hud-dot" style={{ background: DOT[overall], boxShadow: `0 0 6px ${DOT[overall]}` }} />
        <b>staging sync</b>
        <span className="town-hud-verdict" style={{ color: deploying ? '#fbbf24' : bad ? '#fca5a5' : state?.ok ? '#86efac' : '#94a3b8' }}>
          {deploying ? '🚀 deploying…' : running ? 'checking…' : bad ? 'OUT OF SYNC' : state?.ok ? 'in sync' : '—'}
        </span>
        <span style={{ flex: 1 }} />
        <button className="town-hud-btn" onClick={refresh} disabled={running} title="re-run verify-staging.sh now">⟳</button>
        <button className="town-hud-btn" onClick={() => setCol(true)} title="hide">▸</button>
      </div>
      <div className="town-hud-rows">
        {(state?.checks ?? []).map((c) => (
          <div key={c.label} className="town-hud-row" title={c.detail}>
            <span className="town-hud-dot" style={{ background: DOT[c.state] }} />
            <span className="town-hud-label">{c.label}</span>
            <span className="town-hud-state" style={{ color: DOT[c.state] }}>{c.state}</span>
          </div>
        ))}
        {!state?.checks?.length && <div className="town-hud-empty">{running ? 'running verify-staging…' : 'no result yet'}</div>}
      </div>
      <div className="town-hud-foot">verify-staging.sh · {ago(state?.ranAt)}{state?.exitCode != null ? ` · exit ${state.exitCode}` : ''}</div>
    </div>
  );
}
