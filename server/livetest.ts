// Live-tester run manager for Fleet Town. ONE run at a time. On run: resolve
// next-live-tester's tmux pane (so the staging-lock chest follows its sprite),
// acquire the shared staging lock AS next-live-tester (held-by-another ⇒ refuse),
// spawn the suite launcher with the validated env, stream its stdout, and on exit
// read legs.json (best-effort) + release the lock. The harness RUNS + records; the
// per-leg colours are NOT a PASS/FAIL verdict (§ADR-21 — next-investigator owns L3).
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { loadCatalog, type Catalog, type Suite } from './livetest-catalog';
import { recordFromRun, latestLegs } from './livetest-history';
import { cfg, repoRootForPane, type Cfg } from './livetest-git';
import { getFleetState } from './fleet-probe';

// Per-card live progress for a "run the whole catalog" (run-catalog.sh) run —
// parsed from its plan + START/result lines so the panel shows a real-time board.
export type ProgColor = 'green' | 'amber' | 'red';
export interface ProgItem {
  id: string; speed?: string; redfirst?: boolean;
  status: 'pending' | 'running' | 'done';
  rc?: number; summary?: string; color?: ProgColor;
}
export interface RunState {
  status: 'idle' | 'running' | 'done';
  suite?: string; campaign?: string; startedAt?: number; endedAt?: number;
  pid?: number; exitCode?: number | null;
  log: string[];                 // ring buffer (tail)
  progress?: ProgItem[];         // per-card board for batch (run-catalog) runs
  legs?: unknown; evidenceDir?: string;
  error?: string;
}
let run: RunState = { status: 'idle', log: [] };
let child: ChildProcess | null = null;
const LOG_MAX = 500;
const push = (line: string) => { run.log.push(line); if (run.log.length > LOG_MAX) run.log.splice(0, run.log.length - LOG_MAX); };

function progColor(summary: string, rc: number, redfirst: boolean): ProgColor {
  const s = (summary || '').toUpperCase();
  if (s.includes('GREEN')) return 'green';
  if (redfirst) return 'amber';                              // RED is expected here
  if (s.includes('RED')) return 'red';
  if (/AMBER|BLOCKED|REFUSED|SKIP/.test(s)) return 'amber';
  return rc === 0 ? 'green' : 'red';
}
// Update run.progress from one streamed line of run-catalog.sh output.
function parseProgress(line: string): void {
  const p = run.progress; if (!p) return;
  const find = (id: string) => p.find((x) => x.id === id);
  // plan row:  "  D2          FAST       RED-FIRST  ./run-live-d2.sh"
  let m = line.match(/^ {2}([A-Za-z][\w-]*)\s+(FAST|SLOW|OTHER|BATCH)\b\s*(RED-FIRST)?/);
  if (m) { if (!find(m[1])) p.push({ id: m[1], speed: m[2], redfirst: !!m[3], status: 'pending' }); return; }
  // start:  "===== 12:00:00 START D2 (FAST...) gate=… ====="
  m = line.match(/\bSTART (\S+) \(/);
  if (m) { const it = find(m[1]); if (it) it.status = 'running'; else p.push({ id: m[1], status: 'running' }); return; }
  // result: "D2  rc=0  | GREEN 5/5"  (optionally "  [RED-FIRST: RED expected]")
  m = line.match(/^(\S+)\s+rc=(-?\d+)\s+\|\s*(.*)$/);
  if (m) {
    const id = m[1], rc = Number(m[2]);
    const redfirst = /RED-FIRST/.test(m[3]);
    const summary = m[3].replace(/\s*\[RED-FIRST[^\]]*\]\s*$/, '').trim();
    let it = find(id); if (!it) { it = { id, status: 'done' }; p.push(it); }
    it.status = 'done'; it.rc = rc; it.summary = summary; it.redfirst = it.redfirst || redfirst;
    it.color = progColor(summary, rc, it.redfirst);
  }
}

// Candidate repo roots for a run: the opened agent's worktree first, then the
// primary gateway checkout — so the menu/run prefer the agent's own code but still
// work when its worktree is behind (no catalog yet → fall back to primary).
function candidateRoots(paneId?: string): string[] {
  const c = cfg();
  const primary = join(c.integrationDir, '..', '..');
  const wt = repoRootForPane(paneId);
  return wt ? [wt, primary] : [primary];
}
const catalogFor = (paneId?: string): Catalog => loadCatalog(candidateRoots(paneId));

/** The card catalog (+summary) the panel renders, read from the agent's repo. */
export const getCatalog = (paneId?: string) => { const c = catalogFor(paneId); return { suites: c.suites, summary: c.summary }; };
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
 *  the opened live-tester agent → run executes in THAT agent's worktree. trigger
 *  marks who started it (manual click vs the nightly scheduler) for history. */
export async function startRun(suiteId: string, raw: Record<string, unknown>, campaign = 'livetest', paneId?: string, trigger: 'manual' | 'scheduled' = 'manual'):
  Promise<{ ok: true } | { error: string } | { held: unknown }> {
  if (run.status === 'running') return { error: 'a run is already in progress' };
  const c = cfg();
  const cat = catalogFor(paneId);
  const s: Suite | undefined = cat.suites.find((x) => x.id === suiteId);
  if (!cat.root || !s) return { error: `card ${suiteId} not found in the catalog (pull main on this agent?)` };
  if (!s.runnable || !s.command) return { error: `card ${suiteId} is not runnable: ${s.reason || 'no run command'}` };
  const dir = join(cat.root, 'poc/integration');

  const pane = paneId || await nltPane(c.agent);
  const lockEnv = { ...process.env, ...(pane ? { TMUX_PANE: pane } : {}) } as Record<string, string>;
  // A --list / plan preview touches nothing on staging → no lock needed (so the
  // plan + progress board can be previewed even while a real run holds the lock).
  const needsLock = !/(^|\s)--(list|plan)(\s|$)/.test(s.command);
  if (needsLock) {
    // Acquire the staging lock AS next-live-tester. Exit 3 = held by another.
    try {
      execFileSync('bash', [c.lockScript, 'acquire', '--agent', c.agent, '--campaign', campaign, '--reason', `card ${suiteId}`],
        { env: lockEnv, encoding: 'utf8', timeout: 15000 });
    } catch (e) {
      const ex = e as { status?: number };
      if (ex.status === 3) { let holder: unknown = null; try { holder = JSON.parse(execFileSync('bash', [c.lockScript, 'status', '--json'], { encoding: 'utf8' })); } catch { /* */ } return { held: holder }; }
      return { error: `lock acquire failed: ${(e as Error).message.slice(0, 120)}` };
    }
  }

  // systemd's PATH is minimal; the run scripts need bun/node + user bins.
  const extra = [join(homedir(), '.bun/bin'), join(homedir(), '.local/bin'), join(homedir(), 'go/bin')];
  const runEnv = { ...process.env, PATH: [...extra, process.env.PATH || ''].filter(Boolean).join(':'), CAMPAIGN: campaign, ...(pane ? { TMUX_PANE: pane } : {}) } as Record<string, string>;
  void raw; // cards carry no per-run controls now — the env is baked into exec.command

  stopRequested = false;
  run = { status: 'running', suite: suiteId, campaign, startedAt: Date.now(), log: [], exitCode: null, progress: s.batch ? [] : undefined };
  push(`▶ ${s.id} · ${s.title}`);
  push(`$ ${s.command}   (cwd ${dir.replace(homedir(), '~')})`);
  const proc = spawn('bash', ['-c', s.command], { cwd: dir, env: runEnv });
  child = proc; run.pid = proc.pid;
  const onData = (b: Buffer) => b.toString().split('\n').forEach((l) => { if (l) { push(l); parseProgress(l); } });
  proc.stdout?.on('data', onData);
  proc.stderr?.on('data', onData);
  proc.on('close', (code) => {
    run.status = 'done'; run.endedAt = Date.now(); run.exitCode = code;
    push(`■ exited ${code}${code === 3 ? ' (lock held by another)' : code === 2 ? ' (bad config/slot)' : ''}`);
    const found = latestLegs(dir);
    if (found) { run.legs = found.legs; run.evidenceDir = found.dir; }
    // Only release the lock if WE acquired it (a --list preview never did, and must
    // not force-release a real run's lock).
    if (needsLock) { try { execFileSync('bash', [c.lockScript, 'release', '--agent', c.agent, '--force'], { encoding: 'utf8' }); } catch { /* */ } }
    child = null;
    if (needsLock) recordFromRun(run, trigger, s.title); // --list previews aren't real runs
  });
  return { ok: true };
}

// Set by cancelRun → the sequential runner stops after the current card instead
// of marching on to the next one.
let stopRequested = false;
export function cancelRun(): { ok: boolean } {
  stopRequested = true;
  if (child) { try { child.kill('SIGINT'); } catch { /* */ } }
  return { ok: true };
}

/** Run an arbitrary SUBSET of catalog cards back-to-back as one run — for the
 *  scheduler's "pick some cards" mode (run-catalog.sh only does FAST/SLOW, not a
 *  per-id subset). Acquires the staging lock ONCE for the whole sequence, streams
 *  each card's output into the shared run log + progress board, and records one
 *  history entry at the end. Returns immediately; the sequence runs in background. */
export async function startSequence(cardIds: string[], campaign = 'livetest', trigger: 'manual' | 'scheduled' = 'manual', paneId?: string):
  Promise<{ ok: true } | { error: string } | { held: unknown }> {
  if (run.status === 'running') return { error: 'a run is already in progress' };
  const c = cfg();
  const cat = catalogFor(paneId);
  const cards = cardIds.map((id) => cat.suites.find((s) => s.id === id))
    .filter((s): s is Suite => !!s && s.runnable && !!s.command);
  if (!cat.root || !cards.length) return { error: 'no runnable cards in the selection (pull main on this agent?)' };
  const dir = join(cat.root, 'poc/integration');
  const pane = paneId || await nltPane(c.agent);
  const lockEnv = { ...process.env, ...(pane ? { TMUX_PANE: pane } : {}) } as Record<string, string>;
  try {
    execFileSync('bash', [c.lockScript, 'acquire', '--agent', c.agent, '--campaign', campaign, '--reason', `sequence ${cards.length} cards`],
      { env: lockEnv, encoding: 'utf8', timeout: 15000 });
  } catch (e) {
    const ex = e as { status?: number };
    if (ex.status === 3) { let holder: unknown = null; try { holder = JSON.parse(execFileSync('bash', [c.lockScript, 'status', '--json'], { encoding: 'utf8' })); } catch { /* */ } return { held: holder }; }
    return { error: `lock acquire failed: ${(e as Error).message.slice(0, 120)}` };
  }
  const extra = [join(homedir(), '.bun/bin'), join(homedir(), '.local/bin'), join(homedir(), 'go/bin')];
  const runEnv = { ...process.env, PATH: [...extra, process.env.PATH || ''].filter(Boolean).join(':'), CAMPAIGN: campaign, ...(pane ? { TMUX_PANE: pane } : {}) } as Record<string, string>;
  stopRequested = false;
  run = { status: 'running', suite: `cards: ${cards.map((s) => s.id).join(',')}`, campaign, startedAt: Date.now(), log: [], exitCode: null,
    progress: cards.map((s) => ({ id: s.id, speed: s.speed, status: 'pending' as const })) };
  push(`▶ sequence · ${cards.length} card(s): ${cards.map((s) => s.id).join(', ')}`);
  void runSequence(cards, dir, runEnv, c, trigger); // background; panel polls run state
  return { ok: true };
}

async function runSequence(cards: Suite[], dir: string, runEnv: Record<string, string>, c: Cfg, trigger: 'manual' | 'scheduled'): Promise<void> {
  let last = 0;
  for (const s of cards) {
    if (stopRequested) break;
    const item = run.progress?.find((x) => x.id === s.id); if (item) item.status = 'running';
    push(`===== START ${s.id} (${s.speed}) =====`);
    push(`$ ${s.command}`);
    last = await new Promise<number>((resolve) => {
      const proc = spawn('bash', ['-c', s.command], { cwd: dir, env: runEnv });
      child = proc; run.pid = proc.pid;
      const onData = (b: Buffer) => b.toString().split('\n').forEach((l) => { if (l) push(l); });
      proc.stdout?.on('data', onData); proc.stderr?.on('data', onData);
      proc.on('close', (code) => { child = null; resolve(code ?? -1); });
      proc.on('error', () => { child = null; resolve(-1); });
    });
    if (item) { item.status = 'done'; item.rc = last; item.color = last === 0 ? 'green' : 'red'; item.summary = `rc=${last}`; }
    push(`${s.id}  rc=${last}`);
  }
  run.status = 'done'; run.endedAt = Date.now(); run.exitCode = last;
  push(stopRequested ? '■ sequence cancelled' : `■ sequence done (${cards.length} cards)`);
  const found = latestLegs(dir);
  if (found) { run.legs = found.legs; run.evidenceDir = found.dir; }
  try { execFileSync('bash', [c.lockScript, 'release', '--agent', c.agent, '--force'], { encoding: 'utf8' }); } catch { /* */ }
  recordFromRun(run, trigger, `${cards.length} cards`);
}

