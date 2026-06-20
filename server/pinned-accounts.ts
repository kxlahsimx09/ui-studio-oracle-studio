// Remember which Claude account a pinned agent runs on, KEYED BY A HASH OF ITS
// web-auth token — so the town can still name the account after the account's token
// has rotated (e.g. a re-login), which the live exact-token match in plan-detect
// can no longer resolve. The agent's injected token is frozen for its process life,
// so its hash is a stable handle. We store only the hash + the plan name (never the
// raw token).
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const DIR = join(homedir(), '.fleet-town');
const FILE = join(DIR, 'pinned-accounts.json');
const keyOf = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 16);

function load(): Record<string, string> {
  try { return JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string>; } catch { return {}; }
}

/** Record token→plan at spawn/switch (best-effort; survives token rotation). */
export function recordPinned(token: string, planName: string): void {
  if (!token || !planName) return;
  try {
    const m = load(); const k = keyOf(token);
    if (m[k] === planName) return;
    m[k] = planName;
    mkdirSync(DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(m));
  } catch { /* best-effort */ }
}

/** The remembered plan name for a token, or '' if never recorded. */
export function recalledPlan(token: string): string {
  if (!token) return '';
  return load()[keyOf(token)] || '';
}
