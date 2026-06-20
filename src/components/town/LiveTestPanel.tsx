// Live-tester run panel (scoped to next-live-tester's sprite). Pick a suite,
// tick its options, Run → the server acquires the staging lock AS next-live-tester
// and launches the suite's run-live-*.sh, streaming output back. Results are
// "ran + per-leg colour", never PASS/FAIL (§ADR-21 — investigator owns the verdict).
import { useEffect, useRef, useState } from 'react';
import { useLiveTest, runSuite, cancelRun, type Control, type LegInfo } from '../../lib/livetest';
import { useLock } from '../../lib/lock';

const COLOUR: Record<string, string> = { GREEN: '#4ade80', AMBER: '#fbbf24', RED: '#f87171', SKIPPED: '#64748b' };

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

function InfoRow({ k, v, c }: { k: string; v: string; c?: string }) {
  if (!v) return null;
  return (
    <div className="grid grid-cols-[64px_1fr] gap-2 text-[11px] mb-0.5">
      <span className="text-white/40 shrink-0">{k}</span><span style={{ color: c || 'rgba(255,255,255,0.82)' }}>{v}</span>
    </div>
  );
}

// Fullscreen ⓘ card (fixed so the panel's overflow-auto can't clip it). Lists each
// leg the control covers as What / Why / How / Verify.
function InfoCard({ label, info, onClose }: { label: string; info: LegInfo[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-[min(560px,94vw)] max-h-[86vh] overflow-auto rounded-xl border border-white/15 bg-[#0c0c12] p-4 text-left" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[13px] font-semibold text-white/90">ⓘ {label}</span>
          <button onClick={onClose} className="text-white/50 hover:text-white/90 text-sm">✕</button>
        </div>
        {info.map((lg) => (
          <div key={lg.id} className="mb-2.5 rounded-lg border border-white/10 p-2.5">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-[11px] font-mono text-sky-300">{lg.id}</span>
              {lg.ac && <span className="text-[9px] px-1 py-0.5 rounded bg-white/10 text-white/50 font-mono">{lg.ac}</span>}
            </div>
            {lg.title && <div className="text-[12px] font-medium text-white/90 mb-1">{lg.title}</div>}
            <InfoRow k="เทสอะไร" v={lg.what} /><InfoRow k="ทำไม" v={lg.why} />
            <InfoRow k="อย่างไร" v={lg.how} /><InfoRow k="ผ่านเมื่อ" v={lg.verify} c="#86efac" />
          </div>
        ))}
        <p className="text-[10px] text-white/40 mt-1">“ผ่านเมื่อ” = เงื่อนไขที่ leg ขึ้นสีเขียว · harness แค่รัน+บันทึก, คำตัดสินจริงคือ L3 raw-table ของ next-investigator (§ADR-21).</p>
      </div>
    </div>
  );
}

function Field({ c, val, set }: { c: Control; val: unknown; set: (v: unknown) => void }) {
  const [open, setOpen] = useState(false);
  const danger = c.danger ? { color: '#fca5a5' } : {};
  let ctrl;
  if (c.type === 'toggle') ctrl = (
    <label className="flex items-center gap-1.5 text-[11px] min-w-0" style={danger} title={c.help}>
      <input type="checkbox" checked={val === true} onChange={(e) => set(e.target.checked)} /> <span className="truncate">{c.label}</span>
    </label>
  );
  else if (c.type === 'select') ctrl = (
    <label className="flex items-center gap-1.5 text-[11px] text-white/70 min-w-0" title={c.help}>
      <span className="truncate">{c.label}</span> <select className="bg-white/10 rounded px-1 py-0.5" value={String(val ?? c.def ?? '')} onChange={(e) => set(e.target.value)}>
        {c.options?.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
  else ctrl = (
    <label className="flex items-center gap-1.5 text-[11px] text-white/70 min-w-0" title={c.help}>
      <span className="truncate">{c.label}</span> <input type={c.type === 'number' ? 'number' : 'text'} placeholder={c.def || ''} className="bg-white/10 rounded px-1 py-0.5 w-20"
        value={String(val ?? '')} onChange={(e) => set(e.target.value)} />
    </label>
  );
  return (
    <div className="flex items-center gap-1">
      {ctrl}
      {!!c.info?.length && (
        <button onClick={() => setOpen(true)} title="What / why / how this tests"
          className="shrink-0 w-4 h-4 rounded-full border border-white/25 text-[9px] leading-[14px] text-white/55 hover:text-white hover:border-white/60">i</button>
      )}
      {open && !!c.info?.length && <InfoCard label={c.label} info={c.info} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function LiveTestPanel({ onClose }: { onClose: () => void }) {
  const { data } = useLiveTest(true);
  const lock = useLock(3000);
  const [suiteId, setSuiteId] = useState('B');
  const [vals, setVals] = useState<Record<string, unknown>>({});
  const [gvals, setGvals] = useState<Record<string, unknown>>({}); // global controls — persist across suite switches
  const [campaign, setCampaign] = useState('livetest');
  const [msg, setMsg] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const suite = data?.suites.find((s) => s.id === suiteId);
  const run = data?.run;
  const running = run?.status === 'running';
  const heldByOther = !!lock?.locked && lock.holder?.agent !== 'next-live-tester';

  useEffect(() => { setVals({}); setMsg(null); }, [suiteId]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [run?.log]);

  const launch = async () => {
    if (gvals.LIVE_DEDICATED_STACK && !window.confirm('LIVE_DEDICATED_STACK wipes ALL staging transactions at start. Continue?')) return;
    setMsg(null);
    const r = await runSuite(suiteId, { ...gvals, ...vals }, campaign || 'livetest');
    if (r.held) { const h = r.held as { holder?: { agent?: string } }; setMsg(`staging is HELD by ${h.holder?.agent || 'another agent'} — use the 🔒 panel to seize, or wait.`); }
    else if (r.error) setMsg(r.error);
  };

  return (
    <div className="fixed inset-0 z-[56] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-[min(640px,96vw)] max-h-[92vh] overflow-auto rounded-xl border border-white/15 bg-[#0c0c12] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-[14px] text-white/90">🧪 Live-tester run</span>
          <button onClick={onClose} className="text-white/50 hover:text-white/90 text-sm">✕</button>
        </div>
        <p className="text-[11px] text-white/40 mb-2">Runs a suite on staging AS <code className="text-sky-300">next-live-tester</code> (auto-locks the env). Records evidence + per-leg colour — <b>not</b> a PASS/FAIL (§ADR-21).</p>

        {heldByOther && <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/5 px-2.5 py-1.5 text-[11px] text-red-300">🔒 staging held by <b>{lock?.holder?.agent}</b>{lock?.holder?.campaign ? ` (${lock.holder.campaign})` : ''} — Run disabled. Seize/wait via the 🔒 panel.</div>}
        {lock?.disabled && <div className="mb-2 text-[11px] text-amber-300/80">lock disabled — runs won't serialize.</div>}

        {/* suite picker */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {data?.suites.map((s) => (
            <button key={s.id} onClick={() => setSuiteId(s.id)} className="px-2 py-1 rounded text-[11px]"
              style={suiteId === s.id ? { background: '#c084fc22', color: '#d9bbff', border: '1px solid #c084fc66' } : { background: '#ffffff08', color: '#aaa', border: '1px solid #ffffff14' }}>
              {s.label}{s.ownerGated ? ' ⚠' : ''}
            </button>
          ))}
        </div>
        {suite && <p className="text-[10px] text-white/45 mb-2"><code className="text-white/70">{suite.launcher}</code> · ~{suite.runtime} · {suite.gate}{suite.ownerGated ? ' · ⚠ moves SIM money' : ''}</p>}

        {/* global controls — apply to every suite, persist across switches */}
        {!!data?.globals?.length && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-2.5 py-1.5">
            <span className="text-[10px] text-white/40 w-full">Global (all suites)</span>
            {data.globals.map((c) => <Field key={c.env} c={c} val={gvals[c.env]} set={(v) => setGvals((m) => ({ ...m, [c.env]: v }))} />)}
          </div>
        )}

        {/* per-suite options */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-3 rounded-lg border border-white/10 p-2.5">
          {suite?.controls.map((c) => <Field key={c.env} c={c} val={vals[c.env]} set={(v) => setVals((m) => ({ ...m, [c.env]: v }))} />)}
        </div>

        <div className="flex items-center gap-2 mb-2">
          <label className="text-[11px] text-white/60">campaign <input className="bg-white/10 rounded px-1 py-0.5 w-28" value={campaign} onChange={(e) => setCampaign(e.target.value)} /></label>
          {!running
            ? <button disabled={heldByOther} onClick={launch} className="ml-auto px-3 py-1.5 rounded-lg text-[12px] disabled:opacity-40" style={{ background: '#4ade8022', color: '#4ade80', border: '1px solid #4ade8055' }}>▶ Run suite {suiteId}</button>
            : <button onClick={cancelRun} className="ml-auto px-3 py-1.5 rounded-lg text-[12px]" style={{ background: '#f8717122', color: '#fca5a5', border: '1px solid #f8717155' }}>■ Cancel run</button>}
        </div>
        {msg && <p className="text-[11px] text-amber-300 mb-2">{msg}</p>}

        {/* run output */}
        {run && run.status !== 'idle' && (
          <div className="rounded-lg border border-white/10 p-2">
            <div className="flex items-center gap-2 text-[11px] mb-1">
              <span className="font-mono" style={{ color: running ? '#fbbf24' : run.exitCode === 0 ? '#4ade80' : '#f87171' }}>● {run.status}{run.exitCode != null ? ` (exit ${run.exitCode})` : ''}</span>
              <span className="text-white/40">suite {run.suite}</span>
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
