// Telegram alerts for Fleet Town — a second delivery channel alongside Web Push,
// fired by the SAME server-side notify loop (push.ts tick), so alerts go to a
// Telegram chat even with no browser/PWA open. The operator sets a bot token +
// chat id in the town UI; the server stores them and POSTs to the Bot API.
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';

const DIR = join(homedir(), '.fleet-town');
const FILE = join(DIR, 'telegram.json');

// teamIdle on by default; waiting off by default (matches Web Push — avoid spam).
export interface TgConfig { token: string; chatId: string; teamIdle: boolean; waiting: boolean }
const DEFAULT: TgConfig = { token: '', chatId: '', teamIdle: true, waiting: false };

let cfg: TgConfig = (() => {
  try { return { ...DEFAULT, ...JSON.parse(readFileSync(FILE, 'utf8')) }; } catch { return { ...DEFAULT }; }
})();

function persist() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(cfg, null, 2));
  try { chmodSync(FILE, 0o600); } catch { /* best-effort (holds a bot token) */ }
}

export const telegramEnabled = (): boolean => !!cfg.token && !!cfg.chatId;
export const telegramPrefs = (): { teamIdle: boolean; waiting: boolean } => ({ teamIdle: cfg.teamIdle, waiting: cfg.waiting });

/** Send a message to the configured chat. Returns the Bot API outcome. No-op (ok:false)
 *  if unconfigured. Never throws — the notify loop must not break on a Telegram error. */
export async function sendTelegram(text: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!telegramEnabled()) return { ok: false, error: 'telegram not configured' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.chatId, text, disable_web_page_preview: true }),
    });
    if (res.ok) return { ok: true, status: res.status };
    const body = await res.text().catch(() => '');
    return { ok: false, status: res.status, error: body.slice(0, 160) };
  } catch (e) { return { ok: false, error: (e as Error).message.slice(0, 160) }; }
}

// ---- HTTP: /__fleet/telegram* (returns null for non-telegram paths) ----
// GET = status (NEVER returns the token — only a masked hint + chatId + toggles).
export async function handleTelegram(req: Request, p: string): Promise<Response | null> {
  if (p === '/__fleet/telegram') {
    if (req.method === 'GET') {
      const tail = cfg.token ? cfg.token.slice(-4) : '';
      return Response.json({ configured: telegramEnabled(), tokenHint: tail ? `…${tail}` : '', chatId: cfg.chatId, teamIdle: cfg.teamIdle, waiting: cfg.waiting });
    }
    if (req.method === 'POST') {
      const b = (await req.json()) as Partial<TgConfig>;
      // Keep the stored token if the client submits a blank one (UI never echoes it back).
      if (typeof b.token === 'string' && b.token.trim()) cfg.token = b.token.trim();
      if (typeof b.chatId === 'string') cfg.chatId = b.chatId.trim();
      if (typeof b.teamIdle === 'boolean') cfg.teamIdle = b.teamIdle;
      if (typeof b.waiting === 'boolean') cfg.waiting = b.waiting;
      persist();
      return Response.json({ ok: true, configured: telegramEnabled() });
    }
    if (req.method === 'DELETE') { cfg = { ...DEFAULT }; persist(); return Response.json({ ok: true }); }
  }
  if (p === '/__fleet/telegram/test' && req.method === 'POST') {
    const r = await sendTelegram('🔔 Fleet Town — Telegram alerts are on ✅');
    return Response.json(r);
  }
  return null;
}
