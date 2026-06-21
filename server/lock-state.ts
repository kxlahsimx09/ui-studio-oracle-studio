// Staging-env lock state for Fleet Town. Reads the same files the fleet CLI
// scripts/staging-lock.sh writes (the file IS the cross-tool contract):
//   ~/.fleet-town/locks/<name>.json      — holder record (present ⇒ locked)
//   ~/.fleet-town/locks/<name>.disabled  — present ⇒ lock disabled (no locking)
// The town only READS to visualize, and lets the owner force-release / toggle
// disable from the UI. holder.tmux_pane is what PixelTown matches to a sprite.
import { join } from 'node:path';
import { readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const DIR = join(homedir(), '.fleet-town', 'locks');
const lockFile = (name: string) => join(DIR, `${name}.json`);
const disabledFile = (name: string) => join(DIR, `${name}.disabled`);

export interface LockHolder {
  agent: string; campaign: string | null; reason: string | null;
  tmux_pane: string | null; worktree: string; host: string; pid: number;
  acquired_at: string; acquired_epoch: number;
}
export interface LockState {
  name: string; locked: boolean; disabled: boolean; holder: LockHolder | null;
}

export function getLockState(name = 'staging'): LockState {
  if (existsSync(disabledFile(name))) return { name, locked: false, disabled: true, holder: null };
  try {
    const raw = JSON.parse(readFileSync(lockFile(name), 'utf8'));
    if (raw?.locked && raw.holder) return { name, locked: true, disabled: false, holder: raw.holder };
  } catch { /* no/unreadable lock → free */ }
  return { name, locked: false, disabled: false, holder: null };
}

/** Force-release (owner / town UI) — equivalent to `staging-lock.sh release --force`. */
export function releaseLock(name = 'staging'): void {
  rmSync(lockFile(name), { force: true });
}

/** Toggle the global off-switch. Disabled = behaves like before any lock existed. */
export function setDisabled(name = 'staging', disabled: boolean): void {
  mkdirSync(DIR, { recursive: true });
  if (disabled) { writeFileSync(disabledFile(name), ''); rmSync(lockFile(name), { force: true }); }
  else rmSync(disabledFile(name), { force: true });
}
