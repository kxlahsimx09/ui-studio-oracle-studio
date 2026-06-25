// Live-tester run panel — driven by the v2 journey CATALOG (read from the opened
// agent's repo). Pick a card, Run → the server acquires the staging lock AS the
// agent and runs the card's exec.command in that agent's poc/integration, streaming
// output. Results are "ran + per-leg colour", never PASS/FAIL (§ADR-21).
import { useEffect, useRef, useState } from 'react';
import { useLiveTest, runSuite, cancelRun, pullMainRepo, type Suite, type ProgItem } from '../../lib/livetest';
import { useLock } from '../../lib/lock';
import type { FleetAgent } from '../../lib/fleet';

const COLOUR: Record<string, string> = { GREEN: '#4ade80', AMBER: '#fbbf24', RED: '#f87171', SKIPPED: '#64748b' };
const PROG_DOT: Record<string, string> = { green: '#4ade80', amber: '#fbbf24', red: '#f87171' };

// Real-time per-card board for a "run the whole catalog" run.
function ProgressBoard({ items }: { items: ProgItem[] }) {
  const done = items.filter((p) => p.status === 'done');
  const counts = { green: done.filter((p) => p.color === 'green').length, amber: done.filter((p) => p.color === 'amber').length, red: done.filter((p) => p.color === 'red').length };
  return (
    <div className="rounded-lg border border-white/10 p-2 mb-2">
      <div className="flex items-center gap-2 text-[10px] text-white/50 mb-1.5">
        <b className="text-white/80">progress</b> {done.length}/{items.length}
        <span className="ml-auto flex items-center gap-2">
          <span style={{ color: '#4ade80' }}>● {counts.green}</span>
          <span style={{ color: '#fbbf24' }}>● {counts.amber}</span>
          <span style={{ color: '#f87171' }}>● {counts.red}</span>
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
        {items.map((p) => {
          const dot = p.status === 'pending' ? '#3f4654' : p.status === 'running' ? '#7dd3fc' : (PROG_DOT[p.color || ''] || '#64748b');
          return (
            <div key={p.id} className="flex items-center gap-1.5 text-[10px] min-w-0" title={p.summary || p.status}>
              <span className={`w-2 h-2 rounded-full shrink-0${p.status === 'running' ? ' animate-pulse' : ''}`} style={{ background: dot, boxShadow: p.status !== 'pending' ? `0 0 5px ${dot}` : undefined }} />
              <span className="font-mono text-white/80 shrink-0">{p.id}</span>
              <span className="text-white/40 truncate">{p.status === 'running' ? 'running…' : p.status === 'pending' ? 'queued' : (p.summary || `rc ${p.rc}`)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legs({ legs }: { legs: unknown }) {
  if (Array.isArray(legs)) {
    return (
      <div className="flex flex-wrap gap-1 mt-1">
        {legs.map((l, i) => {
          const o = l as Record<string, unknown>;
          const st = String(o.status || o.colour || o.color || '').toUpperCase();
          const id = String(o.id || o.leg || o.name || i);
          return <span key={i} className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: (COLOUR[st] || '#555') + '22', color: COLOUR[st] || '#aaa', border: `1px solid ${(COLOUR[st] || '#555')}66` }}>{id} {st}</span>;
        })}
      </div>
    );
  }
  return <pre className="text-[10px] text-white/50 mt-1 max-h-24 overflow-auto">{JSON.stringify(legs, null, 1)}</pre>;
}

const speedStyle = (s: string) => s === 'FAST'
  ? { background: '#4ade8022', color: '#86efac', border: '1px solid #4ade8055' }
  : s === 'SLOW' ? { background: '#fbbf2422', color: '#fcd34d', border: '1px solid #fbbf2455' }
  : { background: '#ffffff10', color: '#94a3b8', border: '1px solid #ffffff22' };

function CardButton({ s, active, onClick }: { s: Suite; active: boolean; onClick: () => void }) {
  const green = (s.result || '').toUpperCase().startsWith('GREEN');
  return (
    <button onClick={onClick} disabled={!s.runnable && !active}
      className="px-2 py-1 rounded text-[11px] inline-flex items-center gap-1 disabled:opacity-45"
      style={active ? { background: '#c084fc22', color: '#d9bbff', border: '1px solid #c084fc66' }
        : { background: '#ffffff08', color: s.runnable ? '#cbd5e1' : '#7384a0', border: '1px solid #ffffff14' }}
      title={s.runnable ? s.title : `not runnable — ${s.reason}`}>
      <span className="font-mono">{s.id}</span>
      {green && <span style={{ color: '#4ade80' }}>✓</span>}
      {s.ownerGated && <span title="moves real money/bot">⚠</span>}
      {!s.runnable && <span style={{ color: '#64748b' }}>·plan</span>}
    </button>
  );
}

export function LiveTestPanel({ agent, onClose }: { agent?: FleetAgent; onClose: () => void }) {
  const { data } = useLiveTest(true, agent?.paneId);
  const lock = useLock(3000);
  const [suiteId, setSuiteId] = useState('D2'); // default to a FAST regression card
  const [campaign, setCampaign] = useState('livetest');
  const [msg, setMsg] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const suites = data?.suites ?? [];
  const suite = suites.find((s) => s.id === suiteId);
  const run = data?.run;
  const running = run?.status === 'running';
  const heldByOther = !!lock?.locked && lock.holder?.agent !== 'next-live-tester';
  const batch = suites.filter((s) => s.batch);
  const fast = suites.filter((s) => s.runnable && !s.batch && s.speed === 'FAST');
  const slow = suites.filter((s) => s.runnable && !s.batch && s.speed !== 'FAST');
  const planned = suites.filter((s) => !s.runnable && !s.batch);

  const pick = (id: string) => { setSuiteId(id); setMsg(null); };
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [run?.log]);

  const launch = async () => {
    if (!suite?.runnable) { setMsg(`${suiteId} is not runnable: ${suite?.reason || '—'}`); return; }
    if (suite.ownerGated && !window.confirm(`Run ${suite.id} · ${suite.title}?\nThis drives the REAL bank-bot and moves SIM money on staging (owner-gate ${suite.ownerGoEnv}). Continue?`)) return;
    setMsg(null);
    const r = await runSuite(suiteId, {}, campaign || 'livetest', agent?.paneId);
    if (r.held) { const h = r.held as { holder?: { agent?: string } }; setMsg(`staging is HELD by ${h.holder?.agent || 'another agent'} — use the 🔒 panel to seize, or wait.`); }
    else if (r.error) setMsg(r.error);
  };
  const pullMain = async () => {
    if (pulling) return;
    setPulling(true); setMsg(null);
    const r = await pullMainRepo(agent?.paneId);
    setMsg(r.error ? `pull main: ${r.error.slice(0, 300)}` : `✓ pulled main\n${r.output || ''}`);
    setPulling(false);
  };

  return (
    <div className="fixed inset-0 z-[56] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-[min(680px,96vw)] max-h-[92vh] overflow-auto rounded-xl border border-white/15 bg-[#0c0c12] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-[14px] text-white/90">🧪 Live-tester · v2 journey</span>
          <button onClick={onClose} className="text-white/50 hover:text-white/90 text-sm">✕</button>
        </div>
        <p className="text-[11px] text-white/40 mb-2">
          Runs a v2 catalog card on staging AS <code className="text-sky-300">next-live-tester</code> (auto-locks). Records evidence + per-leg colour — <b>not</b> a PASS/FAIL (§ADR-21).
          {data?.summary?.total_cards != null && <> · {data.summary.runnable}/{data.summary.total_cards} runnable</>}
        </p>

        {/* runs in THIS agent's repo + pull latest main */}
        <div className="flex items-center gap-2 mb-2 text-[10px]">
          <span className="text-white/40">runs on:</span>
          <code className="text-sky-300">{agent?.worktree ? `wt ${agent.worktree}` : 'primary checkout'}</code>
          <span className="flex-1" />
          <button onClick={pullMain} disabled={pulling}
            className="px-2 py-1 rounded text-[10px] disabled:opacity-40"
            style={{ background: '#a78bfa22', color: '#c4b5fd', border: '1px solid #a78bfa55' }}
            title="git fetch + ff-merge latest origin/main into this agent's repo (refreshes the catalog + scripts)">
            {pulling ? '⤓ pulling…' : '⤓ pull main'}
          </button>
        </div>

        {heldByOther && <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/5 px-2.5 py-1.5 text-[11px] text-red-300">🔒 staging held by <b>{lock?.holder?.agent}</b>{lock?.holder?.campaign ? ` (${lock.holder.campaign})` : ''} — Run disabled. Seize/wait via the 🔒 panel.</div>}
        {!suites.length && <div className="mb-2 text-[11px] text-amber-300/80">no catalog found in this agent's repo — try ⤓ pull main.</div>}

        {/* card picker — grouped */}
        {!!batch.length && <div className="mb-2"><div className="text-[10px] text-white/40 mb-1">▶ run the whole catalog (serial)</div>
          <div className="flex flex-wrap gap-1.5">{batch.map((s) => <CardButton key={s.id} s={s} active={suiteId === s.id} onClick={() => pick(s.id)} />)}</div></div>}
        {!!fast.length && <div className="mb-2"><div className="text-[10px] text-white/40 mb-1">FAST · regression roster</div>
          <div className="flex flex-wrap gap-1.5">{fast.map((s) => <CardButton key={s.id} s={s} active={suiteId === s.id} onClick={() => pick(s.id)} />)}</div></div>}
        {!!slow.length && <div className="mb-2"><div className="text-[10px] text-white/40 mb-1">SLOW · real bot / callbacks</div>
          <div className="flex flex-wrap gap-1.5">{slow.map((s) => <CardButton key={s.id} s={s} active={suiteId === s.id} onClick={() => pick(s.id)} />)}</div></div>}
        {!!planned.length && <div className="mb-2"><div className="text-[10px] text-white/40 mb-1">not runnable (planned)</div>
          <div className="flex flex-wrap gap-1.5">{planned.map((s) => <CardButton key={s.id} s={s} active={suiteId === s.id} onClick={() => pick(s.id)} />)}</div></div>}

        {/* selected card detail */}
        {suite && (
          <div className="rounded-lg border border-white/10 p-2.5 mb-3 text-[11px]">
            <div className="flex items-center gap-2 mb-1">
              <b className="text-white/90">{suite.id}</b><span className="text-white/70">{suite.title}</span>
              <span className="px-1.5 py-0.5 rounded text-[9px]" style={speedStyle(suite.speed)}>{suite.speed}</span>
              {suite.epic && <span className="text-[9px] text-white/40">{suite.epic}</span>}
              {suite.result && <span className="ml-auto text-[10px]" style={{ color: (suite.result || '').toUpperCase().startsWith('GREEN') ? '#86efac' : '#fcd34d' }}>{suite.result}</span>}
            </div>
            {suite.runnable
              ? <code className="text-[10px] text-sky-300/90 break-all">{suite.command}</code>
              : <div className="text-amber-300/80">⚠ not runnable — {suite.reason}</div>}
            {suite.cast && <div className="text-[10px] text-white/40 mt-1">cast: {suite.cast}</div>}
            {suite.ownerGated && <div className="text-[10px] text-amber-300/80 mt-1">⚠ owner-gated ({suite.ownerGoEnv}) — drives the real bot / moves SIM money</div>}
          </div>
        )}

        <div className="flex items-center gap-2 mb-2">
          <label className="text-[11px] text-white/60">campaign <input className="bg-white/10 rounded px-1 py-0.5 w-28" value={campaign} onChange={(e) => setCampaign(e.target.value)} /></label>
          {!running
            ? <button disabled={heldByOther || !suite?.runnable} onClick={launch} className="ml-auto px-3 py-1.5 rounded-lg text-[12px] disabled:opacity-40" style={{ background: '#4ade8022', color: '#4ade80', border: '1px solid #4ade8055' }}>▶ Run {suiteId}</button>
            : <button onClick={cancelRun} className="ml-auto px-3 py-1.5 rounded-lg text-[12px]" style={{ background: '#f8717122', color: '#fca5a5', border: '1px solid #f8717155' }}>■ Cancel run</button>}
        </div>
        {msg && <pre className="text-[11px] text-amber-300 mb-2 whitespace-pre-wrap break-words font-sans">{msg}</pre>}

        {/* real-time per-card board (catalog runs) */}
        {run?.progress && run.progress.length > 0 && <ProgressBoard items={run.progress} />}

        {/* run output */}
        {run && run.status !== 'idle' && (
          <div className="rounded-lg border border-white/10 p-2">
            <div className="flex items-center gap-2 text-[11px] mb-1">
              <span className="font-mono" style={{ color: running ? '#fbbf24' : run.exitCode === 0 ? '#4ade80' : '#f87171' }}>● {run.status}{run.exitCode != null ? ` (exit ${run.exitCode})` : ''}</span>
              <span className="text-white/40">card {run.suite}</span>
              {run.evidenceDir && <span className="text-white/35 ml-auto truncate" title={run.evidenceDir}>evidence: …/{run.evidenceDir.split('/').slice(-2).join('/')}</span>}
            </div>
            {run.legs != null && <Legs legs={run.legs} />}
            <pre ref={logRef} className="text-[10px] text-white/60 font-mono mt-1 max-h-56 overflow-auto whitespace-pre-wrap">{(run.log || []).join('\n')}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
