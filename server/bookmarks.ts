// Fleet-Town agent bookmarks. A bookmark is the resume recipe for a town-spawned
// (maw-wake) agent — role + worktree + account — so the operator can CLOSE a
// session now and RESPAWN it later with its context (`maw wake --wt <worktree>`,
// no --fresh ⇒ claude --continue). Stored server-side so it survives browser
// reloads and the server can act on it. Team-spawned teammates are NOT bookmarkable
// here (they have no resumable maw-wake worktree — their orchestrator owns them).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadPlans } from './usage';
import { respawnAgent } from './agents';

const DIR = join(homedir(), '.fleet-town');
const FILE = join(DIR, 'bookmarks.json');

export interface Bookmark {
  id: string; role: string; worktree: string;
  planId?: string; planName?: string;
  label?: string; windowName?: string; note?: string; savedAt: number;
}

export function listBookmarks(): Bookmark[] {
  try { const v = JSON.parse(readFileSync(FILE, 'utf8')); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

function save(list: Bookmark[]): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(list, null, 2));
}

// Map a plan display-name (what the fleet badge shows) back to its planId so
// respawn can re-pin the same account. '' / 'Default' / unknown ⇒ default account.
function planIdForName(name?: string): string | undefined {
  if (!name) return undefined;
  const p = loadPlans().find((x) => x.name === name);
  return p && p.id !== 'default' ? p.id : undefined;
}

/** Add (or update) a bookmark from a live agent's captured fields. Keyed by
 *  worktree+role so re-bookmarking the same agent updates in place. */
export function addBookmark(input: {
  role?: string; worktree?: string; planName?: string; label?: string; windowName?: string; note?: string; savedAt: number;
}): Bookmark {
  const role = (input.role || '').trim();
  const worktree = (input.worktree || '').trim();
  if (!role) throw new Error('bookmark needs a role');
  if (!worktree) throw new Error('this agent has no resumable worktree (a primary/oracle pane or a team-spawned teammate cannot be bookmarked for respawn)');
  const bm: Bookmark = {
    id: `${worktree}:${role}`,
    role, worktree,
    planId: planIdForName(input.planName), planName: input.planName,
    label: input.label, windowName: input.windowName, note: input.note,
    savedAt: input.savedAt,
  };
  const list = listBookmarks().filter((b) => b.id !== bm.id);
  list.unshift(bm);
  save(list);
  return bm;
}

export function removeBookmark(id: string): void {
  save(listBookmarks().filter((b) => b.id !== id));
}

/** Respawn a bookmark: RESUME its agent on the same worktree + account. */
export function respawnBookmark(id: string): string {
  const bm = listBookmarks().find((b) => b.id === id);
  if (!bm) throw new Error(`unknown bookmark: ${id}`);
  return respawnAgent(bm.role, bm.worktree, bm.planId);
}
