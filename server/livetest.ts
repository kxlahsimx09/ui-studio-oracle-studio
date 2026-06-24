// Live-tester run manager for Fleet Town. ONE run at a time. On run: resolve
// next-live-tester's tmux pane (so the staging-lock chest follows its sprite),
// acquire the shared staging lock AS next-live-tester (held-by-another ⇒ refuse),
// spawn the suite launcher with the validated env, stream its stdout, and on exit
// read legs.json (best-effort) + release the lock. The harness RUNS + records; the
// per-leg colours are NOT a PASS/FAIL verdict (§ADR-21 — next-investigator owns L3).
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { SUITES, GLOBAL_CONTROLS, suiteById, buildEnv } from './livetest-catalog';
import { infoForControl } from './livetest-info';
import { getFleetState } from './fleet-probe';

interface Cfg { integrationDir: string; lockScript: string; agent: string }
const DEFAULT: Cfg = {
  integrationDir: join(homedir(), 'Code/github.com/kxlahsimx09/mb-next-payment-gateway/poc/integration'),
  lockScript: join(homedir(), 'Code/github.com/Soul-Brews-Studio/arra-oracle-v3/scripts/staging-lock.sh'),
  agent: 'next-live-tester',
};
function cfg(): Cfg {
  try { return { ...DEFAULT, ...JSON.parse(readFileSync(join(import.meta.dir, 'livetest-config.json'), 'utf8')) }; }
  catch { return DEFAULT; }
}

// Resolve the repo the run should execute in FROM THE AGENT'S PANE — its tmux
// cwd → git toplevel → that worktree's poc/integration. So a run uses the code the
// opened live-tester is actually on (its worktree), not a fixed primary checkout.
function paneCwd(id?: string): string | null {
  if (!id || !/^%\d+$/.test(id)) return null;
  try { return execFileSync('tmux', ['display-message', '-p', '-t', id, '#{pane_current_path}'], { encoding: 'utf8' }).trim(); }
  catch { return null; }
}
function repoRoot(cwd: string): string | null {
  try { return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(); }
  catch { return null; }
}
function repoRootForPane(paneId?: string, fallbackIntegrationDir?: string): string | null {
  const cwd = paneCwd(paneId);
  const root = cwd ? repoRoot(cwd) : null;
  if (root) return root;
  return fallbackIntegrationDir ? join(fallbackIntegrationDir, '..', '..') : null;
}
function integrationDirForPane(paneId: string | undefined, fallback: string): string {
  const root = repoRootForPane(paneId);
  if (!root) return fallback;
  const dir = join(root, 'poc/integration');
  return existsSync(dir) ? dir : fallback;
}

export interface RunState {
  status: 'idle' | 'running' | 'done';
  suite?: string; campaign?: string; startedAt?: number; endedAt?: number;
  pid?: number; exitCode?: number | null;
  log: string[];                 // ring buffer (tail)
  legs?: unknown; evidenceDir?: string;
  error?: string;
}
let run: RunState = { status: 'idle', log: [] };
let child: ChildProcess | null = null;
const LOG_MAX = 500;
const push = (line: string) => { run.log.push(line); if (run.log.length > LOG_MAX) run.log.splice(0, run.log.length - LOG_MAX); };

// Enrich each control with its ⓘ leg-info (What/Why/How/Verify) so the panel can
// render an info popover next to the checkbox. Controls without mapped legs are
// passed through unchanged (no ⓘ).
export const getCatalog = () => SUITES.map((s) => ({
  ...s,
  controls: s.controls.map((c) => {
    const info = infoForControl(s.id, c.env);
    return info.length ? { ...c, info } : c;
  }),
}));
export const getGlobals = () => GLOBAL_CONTROLS;
export const getRun = (): RunState => run;

async function nltPane(agent: string): Promise<string> {
  try {
    const st = await getFleetState();
    const a = st.agents.find((x: { role: string; windowName: string; paneId: string }) =>
      x.role === agent || x.windowName?.startsWith(agent));
    return a?.paneId || '';
  } catch { return ''; }
}

/** Start a suite run. Returns {ok} or {held} (lock taken) / {error}. paneId =
 *  the opened live-tester agent → run executes in THAT agent's worktree. */
export async function startRun(suiteId: string, raw: Record<string, unknown>, campaign = 'livetest', paneId?: string):
  Promise<{ ok: true } | { error: string } | { held: unknown }> {
  if (run.status === 'running') return { error: 'a run is already in progress' };
  const s = suiteById(suiteId);
  if (!s) return { error: `unknown suite ${suiteId}` };
  let env: Record<string, string>;
  try { env = buildEnv(suiteId, raw); } catch (e) { return { error: (e as Error).message }; }

  const c = cfg();
  const dir = integrationDirForPane(paneId, c.integrationDir); // the agent's worktree (fallback: primary)
  const launcher = join(dir, s.launcher);
  if (!existsSync(launcher)) return { error: `launcher not found: ${launcher}` };

  const pane = paneId || await nltPane(c.agent);
  const lockEnv = { ...process.env, ...(pane ? { TMUX_PANE: pane } : {}) } as Record<string, string>;
  // Acquire the staging lock AS next-live-tester. Exit 3 = held by another.
  try {
    execFileSync('bash', [c.lockScript, 'acquire', '--agent', c.agent, '--campaign', campaign, '--reason', `suite ${suiteId}`],
      { env: lockEnv, encoding: 'utf8', timeout: 15000 });
  } catch (e) {
    const ex = e as { status?: number };
    if (ex.status === 3) { let holder: unknown = null; try { holder = JSON.parse(execFileSync('bash', [c.lockScript, 'status', '--json'], { encoding: 'utf8' })); } catch { /* */ } return { held: holder }; }
    return { error: `lock acquire failed: ${(e as Error).message.slice(0, 120)}` };
  }

  run = { status: 'running', suite: suiteId, campaign, startedAt: Date.now(), log: [], exitCode: null };
  push(`▶ launching ${s.launcher} in ${dir.replace(homedir(), '~')}  (${Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ') || 'defaults — DRY-VALIDATE'})`);
  const proc = spawn('bash', [launcher], { cwd: dir, env: { ...process.env, ...env, ...(pane ? { TMUX_PANE: pane } : {}) } });
  child = proc; run.pid = proc.pid;
  const onData = (b: Buffer) => b.toString().split('\n').forEach((l) => l && push(l));
  proc.stdout?.on('data', onData);
  proc.stderr?.on('data', onData);
  proc.on('close', (code) => {
    run.status = 'done'; run.endedAt = Date.now(); run.exitCode = code;
    push(`■ exited ${code}${code === 3 ? ' (lock held by another)' : code === 2 ? ' (bad config/slot)' : ''}`);
    const found = latestLegs(dir);
    if (found) { run.legs = found.legs; run.evidenceDir = found.dir; }
    try { execFileSync('bash', [c.lockScript, 'release', '--agent', c.agent, '--force'], { encoding: 'utf8' }); } catch { /* */ }
    child = null;
  });
  return { ok: true };
}

export function cancelRun(): { ok: boolean } {
  if (child) { try { child.kill('SIGINT'); } catch { /* */ } }
  return { ok: true };
}

/** Fetch + fast-forward latest origin/main INTO the agent's repo (its worktree).
 *  ff-only = safe: never rewrites or conflicts; fails clearly if the branch has
 *  its own commits. Used by the panel's "pull main" button before a run. */
export function pullMainRepo(paneId?: string): { ok: true; output: string } | { error: string } {
  const root = repoRootForPane(paneId, cfg().integrationDir);
  if (!root) return { error: 'could not resolve the agent repo (pane gone?)' };
  try {
    const out = execFileSync('bash', ['-c',
      `git -C "${root}" fetch origin main 2>&1 && ` +
      `git -C "${root}" merge --ff-only origin/main 2>&1 && ` +
      `echo "now at $(git -C "${root}" rev-parse --short HEAD) on $(git -C "${root}" rev-parse --abbrev-ref HEAD)"`,
    ], { encoding: 'utf8', timeout: 40000 });
    return { ok: true, output: `${root.replace(homedir(), '~')}\n${out.trim()}` };
  } catch (e) {
    const ex = e as { stdout?: string; stderr?: string; message: string };
    return { error: (ex.stdout || '') + (ex.stderr || '') || ex.message };
  }
}

// Best-effort: the most recently modified legs.json under <dir>/evidence/.
function latestLegs(dir: string): { legs: unknown; dir: string } | null {
  const root = join(dir, 'evidence');
  if (!existsSync(root)) return null;
  let best: { f: string; m: number } | null = null;
  const walk = (d: string, depth: number) => {
    if (depth > 6) return;
    let ents: string[]; try { ents = readdirSync(d); } catch { return; }
    for (const e of ents) {
      const p = join(d, e); let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (e === 'legs.json' && (!best || st.mtimeMs > best.m)) best = { f: p, m: st.mtimeMs };
    }
  };
  walk(root, 0);
  if (!best) return null;
  try { return { legs: JSON.parse(readFileSync(best.f, 'utf8')), dir: best.f.replace(/\/legs\.json$/, '') }; }
  catch { return null; }
}
