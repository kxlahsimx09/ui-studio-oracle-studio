// Path / git-worktree resolution for the live-tester run manager. A run executes
// against the code the OPENED live-tester agent is on (its tmux pane's cwd → git
// toplevel → that worktree's poc/integration), falling back to the primary
// gateway checkout. Split out of livetest.ts to keep that file focused on running.
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export interface Cfg { integrationDir: string; lockScript: string; agent: string }
const DEFAULT: Cfg = {
  integrationDir: join(homedir(), 'Code/github.com/kxlahsimx09/mb-next-payment-gateway/poc/integration'),
  lockScript: join(homedir(), 'Code/github.com/Soul-Brews-Studio/arra-oracle-v3/scripts/staging-lock.sh'),
  agent: 'next-live-tester',
};
export function cfg(): Cfg {
  try { return { ...DEFAULT, ...JSON.parse(readFileSync(join(import.meta.dir, 'livetest-config.json'), 'utf8')) }; }
  catch { return DEFAULT; }
}

function paneCwd(id?: string): string | null {
  if (!id || !/^%\d+$/.test(id)) return null;
  try { return execFileSync('tmux', ['display-message', '-p', '-t', id, '#{pane_current_path}'], { encoding: 'utf8' }).trim(); }
  catch { return null; }
}
function repoRoot(cwd: string): string | null {
  try { return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(); }
  catch { return null; }
}
/** The repo root the run should use: the agent pane's worktree, else the primary
 *  checkout derived from the fallback integration dir. */
export function repoRootForPane(paneId?: string, fallbackIntegrationDir?: string): string | null {
  const cwd = paneCwd(paneId);
  const root = cwd ? repoRoot(cwd) : null;
  if (root) return root;
  return fallbackIntegrationDir ? join(fallbackIntegrationDir, '..', '..') : null;
}

/** Bring latest origin/main INTO the agent's repo (its worktree). Fast-forward
 *  when possible; if the agent's branch has diverged (its own commits), do a real
 *  merge commit. On conflict / dirty tree, ABORT cleanly and report — never leave
 *  the worktree half-merged. Used by the panel's "pull main" button. */
export function pullMainRepo(paneId?: string): { ok: true; output: string } | { error: string } {
  const root = repoRootForPane(paneId, cfg().integrationDir);
  if (!root) return { error: 'could not resolve the agent repo (pane gone?)' };
  const g = `git -C "${root}"`;
  try {
    const out = execFileSync('bash', ['-c',
      `${g} fetch origin main 2>&1 && ` +
      `if ${g} merge --ff-only origin/main 2>/dev/null; then echo "fast-forwarded to origin/main"; ` +
      `elif ${g} merge --no-edit origin/main 2>&1; then echo "merged origin/main into $(${g} rev-parse --abbrev-ref HEAD)"; ` +
      `else ${g} merge --abort 2>/dev/null || true; ` +
      `echo "MERGE BLOCKED — origin/main conflicts with this branch (or the tree is dirty). Commit/stash WIP, then resolve 'git merge origin/main' in the agent."; exit 1; fi; ` +
      `echo "now at $(${g} rev-parse --short HEAD) on $(${g} rev-parse --abbrev-ref HEAD)"`,
    ], { encoding: 'utf8', timeout: 60000 });
    return { ok: true, output: `${root.replace(homedir(), '~')}\n${out.trim()}` };
  } catch (e) {
    const ex = e as { stdout?: string; stderr?: string; message: string };
    return { error: (ex.stdout || '') + (ex.stderr || '') || ex.message };
  }
}
