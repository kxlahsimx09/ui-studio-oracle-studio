// Fleet-Town per-agent notes. Click an agent's nametag → jot what it's doing
// ("waiting on review", "spiking the cache bug"). Visual-only annotation the
// operator writes by hand — distinct from the auto activity bubble (which mirrors
// the pane title). Stored server-side (~/.fleet-town/agent-notes.json) so the same
// note shows on desktop and phone.
//
// Keyed by the STABLE tmux pane id (%NN, never reused) — not the positional
// session:window.pane id, which churns as panes are renumbered. A note for a pane
// that's no longer live simply isn't shown (and is pruned on next overwrite).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DIR = join(homedir(), '.fleet-town');
const FILE = join(DIR, 'agent-notes.json');

export interface AgentNote {
  pane: string;   // stable tmux pane id (%NN)
  note: string;
  savedAt: number;
}

export function listNotes(): AgentNote[] {
  try {
    if (!existsSync(FILE)) return [];
    const v = JSON.parse(readFileSync(FILE, 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function save(list: AgentNote[]): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(list, null, 2));
}

/** Upsert a note for an agent pane. Empty note ⇒ remove (so blanking deletes). */
export function setNote(input: { pane?: string; note?: string; savedAt: number }): AgentNote | null {
  const pane = (input.pane || '').trim();
  if (!pane) throw new Error('a note needs an agent pane id');
  const note = (input.note || '').trim();
  const rest = listNotes().filter((n) => n.pane !== pane);
  if (!note) { save(rest); return null; }
  const rec: AgentNote = { pane, note, savedAt: input.savedAt };
  save([rec, ...rest]);
  return rec;
}

export function removeNote(pane: string): void {
  save(listNotes().filter((n) => n.pane !== pane));
}
