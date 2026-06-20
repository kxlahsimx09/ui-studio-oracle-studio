// Make a per-account Claude config dir (~/.claude-<acct>) carry the SHARED config
// that lives in the default ~/.claude — global MCP servers, hooks, and the hooks
// settings — so an agent pinned via CLAUDE_CONFIG_DIR=<that dir> (which is what
// actually controls BILLING) doesn't lose its tools. The account's own
// .credentials.json stays untouched (that's the point — it bills the right account).
//
// Idempotent + best-effort + no-clobber: only writes when a shared bit is missing,
// so steady-state spawns don't touch the (agent-mutated) .claude.json. Run on every
// pinned spawn (cheap once set up) — see ensureAccountDir.
import { existsSync, readFileSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const DEFAULT_DIR = join(HOME, '.claude');

function readJson(f: string): Record<string, unknown> | null {
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}

/** Bring shared MCP / hooks / hooks-settings from ~/.claude into `dir`. Safe to call
 *  repeatedly; never overwrites the account's credentials or existing MCP entries. */
export function ensureAccountDir(dir: string): void {
  if (!dir || dir === DEFAULT_DIR || !existsSync(dir)) return; // default = nothing to do
  try {
    // 1) hooks/ — symlink to the shared dir (read-only scripts; auto-tracks updates)
    const srcHooks = join(DEFAULT_DIR, 'hooks');
    const dstHooks = join(dir, 'hooks');
    if (existsSync(srcHooks) && !existsSync(dstHooks)) {
      try { symlinkSync(srcHooks, dstHooks); } catch { /* race / already there */ }
    }
    // 2) global mcpServers — merge any the account dir is missing (no clobber).
    const srcCfg = readJson(join(HOME, '.claude.json'));
    const dstF = join(dir, '.claude.json');
    const dstCfg = readJson(dstF) || {};
    const srcMcp = (srcCfg?.mcpServers as Record<string, unknown>) || {};
    const dstMcp = (dstCfg.mcpServers as Record<string, unknown>) || {};
    const missingMcp = Object.keys(srcMcp).filter((k) => !(k in dstMcp));
    // 2b) folder-trust — copy the repo-parent hasTrustDialogAccepted flags from the
    // default dir so interactive agents don't hang on the "trust this folder?" dialog.
    // Worktrees inherit their parent repo's trust, so trusting the repo roots is enough.
    const srcProj = (srcCfg?.projects as Record<string, { hasTrustDialogAccepted?: boolean }>) || {};
    const dstProj = (dstCfg.projects as Record<string, Record<string, unknown>>) || {};
    let trustAdded = false;
    for (const [path, p] of Object.entries(srcProj)) {
      if (p.hasTrustDialogAccepted && !dstProj[path]?.hasTrustDialogAccepted) {
        dstProj[path] = { ...(dstProj[path] || {}), hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true };
        trustAdded = true;
      }
    }
    if (missingMcp.length || trustAdded) {
      if (missingMcp.length) dstCfg.mcpServers = { ...srcMcp, ...dstMcp }; // existing account entries win
      if (trustAdded) dstCfg.projects = dstProj;
      mkdirSync(dir, { recursive: true });
      writeFileSync(dstF, JSON.stringify(dstCfg, null, 2));
    }
    // 3) settings.json — merge the hooks key + set skipDangerousModePermissionPrompt
    // (the per-config-dir "Bypass Permissions mode" acceptance; without it an
    // interactive --dangerously-skip-permissions agent HANGS on the accept prompt).
    const srcSet = readJson(join(DEFAULT_DIR, 'settings.json'));
    const dstSetF = join(dir, 'settings.json');
    const dstSet = readJson(dstSetF) || {};
    let setChanged = false;
    if (srcSet?.hooks && !dstSet.hooks) { dstSet.hooks = srcSet.hooks; setChanged = true; }
    if (dstSet.skipDangerousModePermissionPrompt !== true) { dstSet.skipDangerousModePermissionPrompt = true; setChanged = true; }
    if (setChanged) writeFileSync(dstSetF, JSON.stringify(dstSet, null, 2));
  } catch { /* best-effort: never block a spawn on config replication */ }
}
