// Top-right staging HUD. Collapsible (state persisted). Two separate groups:
//   • Deploy — currency (is each substrate in sync with main, or OUT OF SYNC?)
//   • Services — liveness probes (is each running service up?)
// Each substrate is a coloured dot: green = in sync / up, red = out of sync /
// down, amber = warn, grey = unknown/skipped. Auto-refreshes ~every minute.
import { useState } from 'react';
import type { CheckState, CheckGroup, VerifyCheck, VerifyState } from '../../lib/verify';

const DOT: Record<CheckState, string> = {
  ok: '#4ade80', stale: '#f87171', fail: '#f87171', warn: '#fbbf24', unknown: '#64748b', skipped: '#475569',
};
const KEY = 'town-sync-hud-collapsed';

function ago(ts?: number): string {
  if (!ts) return 'never';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

// Worst state in a group → its summary dot/word.
function summarize(checks: VerifyCheck[], group: CheckGroup): { dot: CheckState; word: string } {
  const cs = checks.filter((c) => c.group === group);
  if (!cs.length) return { dot: 'unknown', word: '—' };
  const bad = cs.some((c) => c.state === 'stale' || c.state === 'fail');
  const warn = cs.some((c) => c.state === 'warn');
  if (bad) return { dot: 'stale', word: group === 'sync' ? 'OUT OF SYNC' : 'DOWN' };
  if (warn) return { dot: 'warn', word: 'warn' };
  const allOk = cs.every((c) => c.state === 'ok');
  return { dot: allOk ? 'ok' : 'unknown', word: allOk ? (group === 'sync' ? 'in sync' : 'all up') : 'partial' };
}

function Section({ title, checks, group }: { title: string; checks: VerifyCheck[]; group: CheckGroup }) {
  const cs = checks.filter((c) => c.group === group);
  if (!cs.length) return null;
  const sum = summarize(checks, group);
  return (
    <div className="town-hud-section">
      <div className="town-hud-subhead">
        <span className="town-hud-dot" style={{ background: DOT[sum.dot], boxShadow: `0 0 5px ${DOT[sum.dot]}` }} />
        <span className="town-hud-subtitle">{title}</span>
        <span className="town-hud-substate" style={{ color: DOT[sum.dot] }}>{sum.word}</span>
      </div>
      {cs.map((c) => (
        <div key={c.label} className="town-hud-row" title={c.detail}>
          <span className="town-hud-dot" style={{ background: DOT[c.state] }} />
          <span className="town-hud-label">{c.label}</span>
          <span className="town-hud-state" style={{ color: DOT[c.state] }}>{c.state}</span>
        </div>
      ))}
    </div>
  );
}

export function SyncHud({ state, refresh }: { state: VerifyState | null; refresh: () => void }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(KEY) === '1');
  const setCol = (v: boolean) => { setCollapsed(v); localStorage.setItem(KEY, v ? '1' : '0'); };

  const running = state?.status === 'running';
  const checks = state?.checks ?? [];
  const sync = summarize(checks, 'sync');
  const service = summarize(checks, 'service');

  if (collapsed) {
    return (
      <button className="town-hud town-hud-pill" onClick={() => setCol(false)} title="staging — deploy sync + service status">
        <span className="town-hud-dot" style={{ background: DOT[sync.dot], boxShadow: `0 0 6px ${DOT[sync.dot]}` }} />
        sync
        <span className="town-hud-dot" style={{ background: DOT[service.dot], boxShadow: `0 0 6px ${DOT[service.dot]}`, marginLeft: 6 }} />
        svc{running ? ' …' : ''}
      </button>
    );
  }

  return (
    <div className="town-hud town-hud-card">
      <div className="town-hud-head">
        <b>staging status</b>
        {running && <span className="town-hud-verdict" style={{ color: '#94a3b8' }}>checking…</span>}
        <span style={{ flex: 1 }} />
        <button className="town-hud-btn" onClick={refresh} disabled={running} title="re-run verify-staging.sh now">⟳</button>
        <button className="town-hud-btn" onClick={() => setCol(true)} title="hide">▸</button>
      </div>
      {!checks.length
        ? <div className="town-hud-empty">{running ? 'running verify-staging…' : 'no result yet'}</div>
        : (
          <>
            <Section title="Deploy · sync" checks={checks} group="sync" />
            <Section title="Services" checks={checks} group="service" />
          </>
        )}
      <div className="town-hud-foot">verify-staging.sh · {ago(state?.ranAt)}{state?.exitCode != null ? ` · exit ${state.exitCode}` : ''}</div>
    </div>
  );
}
