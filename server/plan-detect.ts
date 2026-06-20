// Detect which Claude account a pane's agent runs on, for the town badge.
// maw injects `CLAUDE_CODE_OAUTH_TOKEN=<oat> claude …` (account-pinned spawns), so
// the claude process carries that token in its environment. We read it from
// /proc, match it to a plan, and cache per pane (the token is fixed for the
// process's life). No token in the env → the default logged-in account (no badge).
import { readFileSync, existsSync } from 'node:fs';
import { loadPlans, planAccessToken, planSpawnToken, planConfigDir } from './usage';
import { recalledPlan } from './pinned-accounts';

// paneId → resolved plan label (or '' for default). Cleared when the pane's pid changes.
const cache = new Map<string, { pid: number; label: string }>();

// Find the `claude` process under a pane's shell pid (BFS, depth-limited).
function claudePid(rootPid: number): number | null {
  const seen = new Set<number>();
  let frontier = [rootPid];
  for (let depth = 0; depth < 4 && frontier.length; depth++) {
    const next: number[] = [];
    for (const pid of frontier) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      try {
        const comm = readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
        if (comm === 'claude') return pid;
      } catch { continue; }
      try {
        const kids = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim();
        if (kids) for (const k of kids.split(/\s+/)) next.push(Number(k));
      } catch { /* no children file */ }
    }
    frontier = next;
  }
  return null;
}

// Read the account-pinning env vars from a process: CLAUDE_CONFIG_DIR (controls
// BILLING) and CLAUDE_CODE_OAUTH_TOKEN (legacy/badge-only). NUL-separated KEY=VAL.
function envAccount(pid: number): { dir: string; token: string } {
  const out = { dir: '', token: '' };
  try {
    for (const kv of readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')) {
      if (kv.startsWith('CLAUDE_CONFIG_DIR=')) out.dir = kv.slice('CLAUDE_CONFIG_DIR='.length);
      else if (kv.startsWith('CLAUDE_CODE_OAUTH_TOKEN=')) out.token = kv.slice('CLAUDE_CODE_OAUTH_TOKEN='.length);
    }
  } catch { /* unreadable */ }
  return out;
}

// A config-dir → plan name (the account it bills). The default ~/.claude (or no dir)
// → '' (no badge). A known account dir → its plan name. An unknown dir → 'pinned'.
function planForConfigDir(dir: string): string {
  for (const p of loadPlans()) {
    const pd = planConfigDir(p);
    if (pd && pd === dir) return p.name;
  }
  return 'pinned';
}

// Match an env token to a plan name: exact (a plan's spawn token or current access
// token) first, then the name we recorded at spawn (survives token rotation, e.g. a
// re-login), then a generic 'pinned' if we never recorded it (a pre-recall-era or
// out-of-band spawn). Spawns now inject the long-lived spawnToken, so that match is
// the stable one; planAccessToken stays for legacy/ephemeral-token spawns.
function planForToken(token: string): string {
  for (const p of loadPlans()) {
    if (planSpawnToken(p) === token || planAccessToken(p) === token) return p.name;
  }
  return recalledPlan(token) || 'pinned';
}

/** Plan label for a pane (cached). '' = default logged-in account (no badge).
 *  Prefers CLAUDE_CONFIG_DIR (the account that actually BILLS) over the env token
 *  (badge-only); the config-dir is how agents are pinned since the billing fix. */
export function planForPane(paneId: string, panePid: number): string {
  if (!panePid || !existsSync(`/proc/${panePid}`)) return '';
  const hit = cache.get(paneId);
  if (hit && hit.pid === panePid) return hit.label;
  const cpid = claudePid(panePid);
  const acct = cpid ? envAccount(cpid) : { dir: '', token: '' };
  // A non-default config dir = the real billed account → name it. Else fall back to
  // the legacy token badge. Default dir + no token = default account (no badge).
  const isDefaultDir = !acct.dir || acct.dir === `${process.env.HOME}/.claude` || acct.dir.replace(/\/$/, '').endsWith('/.claude');
  const label = !isDefaultDir ? planForConfigDir(acct.dir)
    : acct.token ? planForToken(acct.token) : '';
  cache.set(paneId, { pid: panePid, label });
  return label;
}

/** Drop cache entries for panes no longer present. */
export function prunePlanCache(livePaneIds: Set<string>): void {
  for (const id of [...cache.keys()]) if (!livePaneIds.has(id)) cache.delete(id);
}
