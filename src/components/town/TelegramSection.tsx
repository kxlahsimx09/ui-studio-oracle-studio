// Telegram-alert setup for Fleet Town. Enter a bot token + chat id → the SERVER
// stores them and fires team-idle / agent-waiting alerts to that chat (same notify
// loop as Web Push), so alerts arrive with no browser open. Works regardless of PWA
// push support. The token is write-only: the server never echoes it back (masked).
import { useEffect, useState } from 'react';

interface Status { configured: boolean; tokenHint: string; chatId: string; teamIdle: boolean; waiting: boolean }
const get = () => fetch('/__fleet/telegram').then((r) => r.json());
const post = (body: object) => fetch('/__fleet/telegram', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

export function TelegramSection() {
  const [st, setSt] = useState<Status | null>(null);
  const [token, setToken] = useState('');     // entry only — never populated from server
  const [chatId, setChatId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const reload = () => get().then((s: Status) => { setSt(s); setChatId(s.chatId || ''); }).catch(() => {});
  useEffect(() => { reload(); }, []);

  const save = async (extra: Partial<Status> = {}) => {
    setBusy(true); setMsg('');
    try {
      const body: Record<string, unknown> = { chatId, ...extra };
      if (token.trim()) body.token = token.trim();   // omit when blank → server keeps the stored one
      const r = await post(body);
      if (r.error) setMsg(r.error);
      else { setToken(''); await reload(); setMsg(r.configured ? 'saved ✓' : 'saved — needs token + chat id to fire'); }
    } catch { setMsg('save failed'); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setMsg('sending…');
    try { const r = await fetch('/__fleet/telegram/test', { method: 'POST' }).then((x) => x.json()); setMsg(r.ok ? 'sent ✓ — check your chat' : `error ${r.status || ''}: ${r.error || ''}`.slice(0, 120)); }
    catch { setMsg('request failed'); } finally { setBusy(false); }
  };
  const clear = async () => { setBusy(true); try { await fetch('/__fleet/telegram', { method: 'DELETE' }); await reload(); setMsg('cleared'); } finally { setBusy(false); } };

  const inp = 'w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white/85 placeholder-white/30';

  return (
    <div className="mt-2 border-t border-white/10 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-white/90 font-medium">✈️ Telegram alerts</span>
        {st?.configured && <span className="text-[10px] text-emerald-300/80">on {st.tokenHint}</span>}
      </div>
      <p className="text-[10px] text-white/40 mt-0.5 mb-1.5">Server pushes the same alerts to a Telegram chat — works with the web closed.</p>

      <input className={inp} type="password" placeholder={st?.configured ? 'bot token (stored — leave blank to keep)' : 'bot token (123456:ABC…)'} value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
      <input className={`${inp} mt-1`} placeholder="chat id (e.g. 123456789 or -100…)" value={chatId} onChange={(e) => setChatId(e.target.value)} autoComplete="off" />

      {st && (
        <div className="mt-1.5 space-y-0.5">
          <Toggle label="💤 Team idle" checked={st.teamIdle} onChange={(v) => save({ teamIdle: v })} />
          <Toggle label="🔔 Needs input (any agent)" checked={st.waiting} onChange={(v) => save({ waiting: v })} />
        </div>
      )}

      <div className="mt-2 flex gap-2">
        <button onClick={() => save()} disabled={busy} className="flex-1 rounded-lg py-1 text-[11px] font-semibold" style={{ background: '#38bdf833', color: '#7dd3fc', border: '1px solid #38bdf855' }}>Submit</button>
        <button onClick={test} disabled={busy || !st?.configured} className="flex-1 rounded-lg py-1 text-[11px] disabled:opacity-40" style={{ background: '#ffffff10', color: '#bbb' }}>Test</button>
        {st?.configured && <button onClick={clear} disabled={busy} className="rounded-lg px-2 py-1 text-[11px]" style={{ background: '#f8717118', color: '#fca5a5' }}>Clear</button>}
      </div>
      {msg && <p className="mt-1 text-[10px] text-white/55">{msg}</p>}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 py-0.5 cursor-pointer">
      <span className="text-[11px] text-white/75">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-sky-400 shrink-0" />
    </label>
  );
}
