// Staging-deploy runner for Fleet Town. Wraps the gateway's scripted deploy
// (scripts/deploy-staging.sh) so the operator can deploy from the town — pick
// which slice (full / UI-only / dry-run), optionally pull main first, and watch
// the script's stdout/stderr stream live to spot errors.
//
// ALWAYS runs from the PRIMARY checkout of each repo (never a .wt-* worktree):
// the deploy script keys off `git rev-parse --show-toplevel`, so cwd = the
// primary gateway clone makes $ROOT the primary. The pull-main button fetches +
// checks out + ff-pulls main on BOTH primary checkouts (gateway + admin portal).
//
// One run at a time (shared with the live-tester slot in spirit, but tracked
// here). Mirror-only: this never decides — the operator clicks, we run + show.
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';

interface Cfg { gatewayRepo: string; uiRepo: string; bankbotRepo: string }
const DEFAULT: Cfg = {
  gatewayRepo: join(homedir(), 'Code/github.com/kxlahsimx09/mb-next-payment-gateway'),
  uiRepo: join(homedir(), 'Code/github.com/kxlahsimx09/mb-next-admin-portal'),
  bankbotRepo: join(homedir(), 'Code/github.com/kxlahsimx09/mb-next-bank-bot'),
};
// The primary checkouts "pull main" / "pull main first" keep up to date — all
// three substrate repos: gateway (backend), admin portal (UI), bank-bot fleet.
const primaryRepos = (c: Cfg) => [c.gatewayRepo, c.uiRepo, c.bankbotRepo].filter((r) => existsSync(join(r, '.git')));
function cfg(): Cfg {
  try { return { ...DEFAULT, ...JSON.parse(readFileSync(join(import.meta.dir, 'deploy-config.json'), 'utf8')) }; }
  catch { return DEFAULT; }
}

// systemd gives the service a minimal PATH; the deploy script needs tools that
// live in the user's bin dirs (supabase, ghq) + bun. Prepend them so spawned
// `command -v` checks resolve the same binaries the operator's shell would.
function runEnv(): Record<string, string> {
  const extra = [join(homedir(), '.bun/bin'), join(homedir(), '.local/bin'), join(homedir(), 'go/bin')];
  const path = [...extra, process.env.PATH || ''].filter(Boolean).join(':');
  return { ...process.env, PATH: path } as Record<string, string>;
}

export type DeployMode = 'full' | 'ui' | 'migrations' | 'ef' | 'bankbot';
// slice → the deploy-staging.sh substrate flag (full = all 5, no flag)
const MODE_FLAG: Record<Exclude<DeployMode, 'full'>, string> = {
  ui: '--ui-only', migrations: '--migrations-only', ef: '--ef-only', bankbot: '--bankbot-only',
};
const MODE_LABEL: Record<DeployMode, string> = {
  full: 'full', ui: 'UI-only', migrations: 'migrations-only', ef: 'edge-fns-only', bankbot: 'bankbot-only',
};
export interface DeployState {
  status: 'idle' | 'running' | 'done';
  action?: string;               // human label ("full deploy", "pull main (both repos)")
  startedAt?: number; endedAt?: number;
  pid?: number; exitCode?: number | null;
  log: string[];                 // ring buffer (tail)
}
let run: DeployState = { status: 'idle', log: [] };
let child: ChildProcess | null = null;
const LOG_MAX = 800;
const push = (line: string) => { run.log.push(line); if (run.log.length > LOG_MAX) run.log.splice(0, run.log.length - LOG_MAX); };

export const getDeploy = (): DeployState => run;

function begin(action: string, display: string, cmd: string, args: string[], cwd: string): { ok: true } | { error: string } {
  if (run.status === 'running') return { error: 'a deploy/pull is already in progress' };
  run = { status: 'running', action, startedAt: Date.now(), exitCode: null, log: [] };
  push(`▶ ${action}`);
  push(`$ ${display}   (cwd: ${cwd.replace(homedir(), '~')})`);
  let proc: ChildProcess;
  try { proc = spawn(cmd, args, { cwd, env: runEnv() }); }
  catch (e) { run.status = 'done'; run.endedAt = Date.now(); run.exitCode = -1; push(`✖ spawn failed: ${(e as Error).message}`); return { error: (e as Error).message }; }
  child = proc; run.pid = proc.pid;
  const onData = (b: Buffer) => b.toString().split('\n').forEach((l) => { if (l) push(l); });
  proc.stdout?.on('data', onData);
  proc.stderr?.on('data', onData);
  proc.on('close', (code) => {
    run.status = 'done'; run.endedAt = Date.now(); run.exitCode = code;
    push(`■ exited ${code}${code === 0 ? ' — OK' : ' — see output above'}`);
    child = null;
  });
  return { ok: true };
}

// Bring one primary checkout to the LATEST origin/main. The catch: `main` is
// often already checked out in a sibling .wt-* worktree, so `git checkout main`
// in the primary is refused ("already used by worktree …"). So: fetch, then try
// to land ON main (ff-merge); if the branch is held elsewhere, detach onto
// origin/main — same commit, deployable, just no branch label. Best-effort per
// repo (never aborts the other), every step echoed so the stream reads cleanly.
function updateMainSnippet(repo: string): string {
  const q = `"${repo}"`;
  return [
    `echo "── ${repo.replace(homedir(), '~')}"`,
    `git -C ${q} fetch origin main || echo "  fetch failed"`,
    `if git -C ${q} checkout main 2>/dev/null; then ` +
      `git -C ${q} merge --ff-only origin/main || echo "  ff-merge failed (main diverged?)"; ` +
    `elif git -C ${q} checkout --detach origin/main 2>/dev/null; then ` +
      `echo "  main is checked out in another worktree → detached onto origin/main"; ` +
    `else echo "  FAILED to land on main (dirty tree?)"; fi`,
    `echo "  now at $(git -C ${q} rev-parse --short HEAD 2>/dev/null) ($(git -C ${q} rev-parse --abbrev-ref HEAD 2>/dev/null))"`,
  ].join('; ');
}

/** Run the gateway's deploy-staging.sh from the PRIMARY gateway checkout. When
 *  "pull main first" is set, run our own worktree-safe update on BOTH repos
 *  first (the script's own --pull-main breaks when main is held by a worktree). */
export function startDeploy(opts: {
  mode?: DeployMode; dry?: boolean; pull?: boolean; allowDirty?: boolean; skipGate?: boolean;
}): { ok: true } | { error: string } {
  const c = cfg();
  const script = join(c.gatewayRepo, 'scripts/deploy-staging.sh');
  if (!existsSync(script)) return { error: `deploy script not found: ${script}` };
  const mode = opts.mode || 'full';
  const args: string[] = [];
  if (mode !== 'full') args.push(MODE_FLAG[mode]);
  args.push(opts.dry ? '--dry-run' : '--deploy');
  // Env overrides: WF7_ALLOW_DIRTY=1 bypasses the clean-tree guard; WF7_SKIP_GATE=1
  // continues past a RED deployed-shape gate — script honours it only on --dry-run,
  // so we gate it on dry too (no skipping the gate on a live mutation).
  const envPrefix = [
    opts.allowDirty ? 'WF7_ALLOW_DIRTY=1' : '',
    opts.skipGate && opts.dry ? 'WF7_SKIP_GATE=1' : '',
  ].filter(Boolean).join(' ');
  const deployCmd = `${envPrefix ? envPrefix + ' ' : ''}bash "${script}" ${args.join(' ')}`;
  const cmd = opts.pull ? `${primaryRepos(c).map(updateMainSnippet).join('; ')}; echo; ${deployCmd}` : deployCmd;
  const extras = [opts.pull && '+pull', opts.allowDirty && '+allow-dirty', opts.skipGate && opts.dry && '+skip-gate']
    .filter(Boolean).join(' ');
  const label = `${MODE_LABEL[mode]} ${opts.dry ? 'dry-run' : 'deploy'}${extras ? ' ' + extras : ''}`;
  const display = `${opts.pull ? 'pull main → ' : ''}${deployCmd.replace(`"${script}"`, 'deploy-staging.sh')}`;
  return begin(`staging ${label}`, display, 'bash', ['-c', cmd], c.gatewayRepo);
}

/** Bring every primary checkout (gateway + UI + bank-bot) to latest origin/main. */
export function startPullMain(): { ok: true } | { error: string } {
  const c = cfg();
  const repos = primaryRepos(c);
  if (!repos.length) return { error: 'no primary checkouts found for gateway / admin-portal / bank-bot' };
  const display = `git fetch + land on origin/main × ${repos.length} repos`;
  return begin('pull main (all repos)', display, 'bash', ['-c', repos.map(updateMainSnippet).join('; ')], c.gatewayRepo);
}

export function cancelDeploy(): { ok: boolean } {
  if (child) { try { child.kill('SIGINT'); } catch { /* */ } }
  return { ok: true };
}
