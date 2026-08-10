// Nightly auto-run scheduler menu for the live-tester panel. Enable/disable, set a
// time (GMT+7), choose Fast / Full / Slow / a hand-picked card subset, and save.
// Server persists it (~/.fleet-town/livetest-schedule.json) and fires it nightly.
import { useEffect, useState } from 'react';
import { getSchedule, saveSchedule, runSequence, type Schedule, type SchedMode, type Suite } from '../../lib/livetest';

const MODES: { id: SchedMode; label: string; warn?: boolean }[] = [
  { id: 'fast', label: 'Fast · no money' },
  { id: 'full', label: 'Full · FAST+SLOW', warn: true },
  { id: 'slow', label: 'Slow only', warn: true },
  { id: 'cards', label: 'Pick cards' },
];

export function LiveTestSchedule({ suites, paneId }: { suites: Suite[]; paneId?: string }) {
  const [s, setS] = useState<Schedule | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { getSchedule().then(setS).catch(() => {}); }, []);
  if (!s) return <div className="text-[11px] text-white/40 px-1 py-2">loading schedule…</div>;

  const cards = suites.filter((x) => x.runnable && !x.batch);
  const set = (patch: Partial<Schedule>) => setS({ ...s, ...patch });
  const toggleCard = (id: string) => set({ cards: s.cards.includes(id) ? s.cards.filter((c) => c !== id) : [...s.cards, id] });
  const save = async () => { setSaving(true); setMsg(null); try { setS(await saveSchedule(s)); setMsg('saved ✓'); } catch { setMsg('save failed'); } finally { setSaving(false); } };
  const runNow = async () => {
    if (!s.cards.length) { setMsg('tick some cards first'); return; }
    setMsg(null);
    const r = await runSequence(s.cards, 'livetest-sched', paneId);
    setMsg(r.error ? r.error : r.held ? 'staging held by another agent' : 'started ▶ (see run output above)');
  };
  const moneyWarn = s.mode === 'full' || s.mode === 'slow';

  return (
    <div className="rounded-lg border border-white/10 p-2.5 mb-3 text-[11px] space-y-2" style={{ background: '#1e1b2e44' }}>
      <label className="flex items-center gap-2 flex-wrap">
        <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span className="text-white/80">Auto-run nightly at</span>
        <input type="time" value={s.time} onChange={(e) => set({ time: e.target.value })} className="bg-white/10 rounded px-1 py-0.5 text-white/80" />
        <span className="text-white/35">GMT+7</span>
      </label>
      <div className="flex flex-wrap gap-1.5">
        {MODES.map((m) => (
          <button key={m.id} onClick={() => set({ mode: m.id })} className="px-2 py-1 rounded text-[10px]"
            style={s.mode === m.id ? { background: '#38bdf822', color: '#7dd3fc', border: '1px solid #38bdf866' } : { background: '#ffffff08', color: '#aaa', border: '1px solid #ffffff14' }}>
            {m.warn ? '⚠ ' : ''}{m.label}
          </button>
        ))}
      </div>
      {moneyWarn && <div className="text-amber-300/80">⚠ runs the REAL bot + moves SIM money every night (~1.5–2 hr). Make sure that's intended.</div>}
      {s.mode === 'cards' && (
        <div className="flex flex-wrap gap-1 items-center">
          {cards.length ? cards.map((c) => (
            <button key={c.id} onClick={() => toggleCard(c.id)} title={`${c.title} · ${c.speed}`} className="px-1.5 py-0.5 rounded text-[10px]"
              style={s.cards.includes(c.id) ? { background: '#4ade8022', color: '#86efac', border: '1px solid #4ade8055' } : { background: '#ffffff08', color: '#888', border: '1px solid #ffffff14' }}>{c.id}</button>
          )) : <span className="text-white/40">no runnable cards (pull main?)</span>}
          {!!s.cards.length && <span className="text-white/40">· {s.cards.length} picked</span>}
        </div>
      )}
      <label className="flex items-center gap-2 text-white/70">
        <input type="checkbox" checked={s.pullMain} onChange={(e) => set({ pullMain: e.target.checked })} />
        pull main (primary checkout) before the nightly run
      </label>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={save} disabled={saving} className="px-3 py-1 rounded text-[11px] disabled:opacity-40" style={{ background: '#38bdf822', color: '#7dd3fc', border: '1px solid #38bdf855' }}>{saving ? 'saving…' : '💾 Save schedule'}</button>
        {s.mode === 'cards' && <button onClick={runNow} className="px-3 py-1 rounded text-[11px]" style={{ background: '#4ade8022', color: '#4ade80', border: '1px solid #4ade8055' }}>▶ Run selection now</button>}
        {msg && <span className="text-white/60">{msg}</span>}
      </div>
      {s.enabled && <div className="text-white/40">⏰ nightly {s.time} · {s.mode}{s.mode === 'cards' ? ` (${s.cards.length})` : ''}{s.lastResult ? ` · last: ${s.lastResult}` : ''}</div>}
    </div>
  );
}
