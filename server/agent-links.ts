// Fleet-Town agent links — a hand-drawn "who waits for whom" edge between two
// live agents. The operator drags agent A onto agent B in the town to record
// "A is waiting on B"; an arrow A→B with a note is drawn on the map. Stored
// server-side (NOT browser localStorage) so the wiring is the same on the desktop
// and on a phone — open the town anywhere and the dependency arrows are there.
//
// Links are PURELY visual annotation: the town never acts on them (Mirror, never
// drives). Keyed by `from>to` so re-dragging the same pair updates the note in
// place instead of stacking duplicate arrows. Endpoints are agent ids
// (`session:window.pane`); if an agent is gone the arrow simply isn't drawn.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DIR = join(homedir(), '.fleet-town');
const FILE = join(DIR, 'links.json');

export interface AgentLink {
  id: string;       // stable per ordered pair (keyed by pane ids when available)
  from: string;     // waiting agent's positional id (arrow tail) — display / legacy
  to: string;       // depended-on agent's positional id (arrow head)
  fromPane: string; // stable tmux pane id (%NN) — what the map resolves the arrow by
  toPane: string;
  note: string;     // free text shown on the line ("blocked on schema", …)
  savedAt: number;
}

export function listLinks(): AgentLink[] {
  try {
    if (!existsSync(FILE)) return [];
    const v = JSON.parse(readFileSync(FILE, 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function save(list: AgentLink[]): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(list, null, 2));
}

/** Add or update (upsert) a link A→B. Re-dragging the same pair edits the note.
 *  Keyed by the stable pane ids when present (positional ids churn as panes are
 *  renumbered), falling back to the positional ids for legacy callers. */
export function addLink(input: {
  from?: string; to?: string; fromPane?: string; toPane?: string; note?: string; savedAt: number;
}): AgentLink {
  const from = (input.from || '').trim();
  const to = (input.to || '').trim();
  const fromPane = (input.fromPane || '').trim();
  const toPane = (input.toPane || '').trim();
  if (!from || !to) throw new Error('a link needs both a from and a to agent');
  if (from === to) throw new Error('an agent cannot wait on itself');
  const id = fromPane && toPane ? `${fromPane}>${toPane}` : `${from}>${to}`;
  const link: AgentLink = { id, from, to, fromPane, toPane, note: (input.note || '').trim(), savedAt: input.savedAt };
  const list = listLinks().filter((l) => l.id !== link.id);
  list.unshift(link);
  save(list);
  return link;
}

export function removeLink(id: string): void {
  save(listLinks().filter((l) => l.id !== id));
}
