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

interface Cfg { gatewayRepo: string; uiRepo: string }
const DEFAULT: Cfg = {
  gatewayRepo: join(homedir(), 'Code/github.com/kxlahsimx09/mb-next-payment-gateway'),
  uiRepo: join(homedir(), 'Code/github.com/kxlahsimx09/mb-next-admin-portal'),
};
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

export type DeployMode = 'full' | 'ui';
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

function begin(action: string, cmd: string, args: string[], cwd: string): { ok: true } | { error: string } {
  if (run.status === 'running') return { error: 'a deploy/pull is already in progress' };
  run = { status: 'running', action, startedAt: Date.now(), exitCode: null, log: [] };
  push(`▶ ${action}`);
  push(`$ ${cmd} ${args.join(' ')}   (cwd: ${cwd.replace(homedir(), '~')})`);
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

/** Run the gateway's deploy-staging.sh from the PRIMARY gateway checkout. */
export function startDeploy(opts: { mode?: DeployMode; dry?: boolean; pull?: boolean }): { ok: true } | { error: string } {
  const c = cfg();
  const script = join(c.gatewayRepo, 'scripts/deploy-staging.sh');
  if (!existsSync(script)) return { error: `deploy script not found: ${script}` };
  const args: string[] = [];
  if (opts.mode === 'ui') args.push('--ui-only');
  args.push(opts.dry ? '--dry-run' : '--deploy');
  if (opts.pull) args.push('--pull-main');
  const label = `${opts.mode === 'ui' ? 'UI-only ' : 'full '}${opts.dry ? 'dry-run' : 'deploy'}${opts.pull ? ' (+pull main)' : ''}`;
  return begin(`staging ${label}`, 'bash', [script, ...args], c.gatewayRepo);
}

/** Fetch + checkout main + ff-pull on BOTH primary checkouts (gateway + UI). */
export function startPullMain(): { ok: true } | { error: string } {
  const c = cfg();
  const repos = [c.gatewayRepo, c.uiRepo].filter((r) => existsSync(join(r, '.git')));
  if (!repos.length) return { error: 'no primary checkouts found for gateway / admin-portal' };
  // One bash that walks both repos, echoing each step so the stream is readable.
  const lines = repos.map((r) =>
    `echo "── ${r.replace(homedir(), '~')}"; ` +
    `git -C "${r}" fetch origin main && git -C "${r}" checkout main && git -C "${r}" pull --ff-only && ` +
    `echo "  now at $(git -C "${r}" rev-parse --short HEAD) on $(git -C "${r}" rev-parse --abbrev-ref HEAD)" || echo "  FAILED for ${r}"`,
  ).join('; ');
  return begin('pull main (both repos)', 'bash', ['-c', lines], c.gatewayRepo);
}

export function cancelDeploy(): { ok: boolean } {
  if (child) { try { child.kill('SIGINT'); } catch { /* */ } }
  return { ok: true };
}
