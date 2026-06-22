// Carry a session over to a FRESH agent when context runs low. The running agent
// writes a handoff brief to a file; then we replace it IN PLACE with a brand-new
// clean session (same role / worktree / account) that is told to read the brief and
// continue. So you keep momentum without dragging a near-full context window along.
//
// Safety: we do NOT kill the old agent until its brief file exists — if it can't
// produce one (e.g. truly out of context), we abort and leave it untouched.
import { execFileSync } from 'node:child_process';
import { readFileSync, readlinkSync, existsSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
const BRIEF = '.carry-over-brief.md';

function claudePid(rootPid: number): number | null {
  let frontier = [rootPid]; const seen = new Set<number>();
  for (let d = 0; d < 6 && frontier.length; d++) {
    const next: number[] = [];
    for (const pid of frontier) {
      if (seen.has(pid)) continue; seen.add(pid);
      try { if (readFileSync(`/proc/${pid}/comm`, 'utf8').trim() === 'claude') return pid; } catch { continue; }
      try { const k = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim(); if (k) for (const x of k.split(/\s+/)) next.push(Number(x)); } catch { /* */ }
    }
    frontier = next;
  }
  return null;
}
const paneCmd = (pane: string) => execFileSync('tmux', ['display', '-p', '-t', pane, '#{pane_current_command}'], { encoding: 'utf8' }).trim();
const sendLine = (pane: string, text: string) => {
  execFileSync('tmux', ['set-buffer', '-b', 'carryover', '--', text]);
  execFileSync('tmux', ['paste-buffer', '-p', '-d', '-b', 'carryover', '-t', pane]);
  execFileSync('tmux', ['send-keys', '-t', pane, 'Enter']);
};

const BRIEF_PROMPT = (f: string) =>
  `⚠️ CONTEXT CARRY-OVER. You are about to be replaced by a fresh agent (clean context) that continues your work. Write a thorough handoff to \`${f}\` in your current directory covering: (1) your role + task/campaign, (2) what you've done, (3) what's in progress / next steps, (4) key decisions, files, PRs, gotchas, (5) any pending teammate/dispatch state. Write the FILE now (not just a chat reply), then reply "BRIEF WRITTEN".`;
const SEED = (f: string) =>
  `You are a fresh continuation of a session that ran low on context. Your predecessor left a handoff brief at \`${f}\` in this directory — read it first, then pick up the work from there.`;

/** Carry over the agent in `paneId` to a fresh clean session, briefed via a file. */
export async function carryOver(paneId: string): Promise<{ ok: boolean }> {
  if (!/^%\d+$/.test(paneId)) throw new Error('bad pane id');
  const panePid = Number(execFileSync('tmux', ['display', '-p', '-t', paneId, '#{pane_pid}'], { encoding: 'utf8' }).trim());
  const cpid = claudePid(panePid);
  if (!cpid) throw new Error('no running claude in that pane');

  const cwd = readlinkSync(`/proc/${cpid}/cwd`);
  const env = readFileSync(`/proc/${cpid}/environ`, 'utf8').split('\0');
  const acctEnv = env.filter((kv) => /^(CLAUDECODE|CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS|CLAUDE_CONFIG_DIR|CLAUDE_CODE_OAUTH_TOKEN)=/.test(kv));
  const argv = readFileSync(`/proc/${cpid}/cmdline`, 'utf8').split('\0').filter(Boolean);
  const briefPath = join(cwd, BRIEF);

  // Ask the (still-running) agent to write its brief; clear any stale one first.
  try { rmSync(briefPath); } catch { /* none */ }
  sendLine(paneId, BRIEF_PROMPT(BRIEF));

  // Wait for the brief file (non-empty). Don't touch the agent until it exists.
  let ok = false;
  for (let i = 0; i < 60; i++) { // ~120s
    await sleep(2000);
    try { if (statSync(briefPath).size > 40) { ok = true; break; } } catch { /* not yet */ }
  }
  if (!ok) throw new Error('the agent did not write a brief (too low on context?) — left untouched; try again or handoff manually');

  // Replace with a FRESH clean session in the same pane (no --continue/--resume).
  try { process.kill(cpid, 'SIGTERM'); } catch { /* */ }
  for (let i = 0; i < 12 && existsSync(`/proc/${cpid}`); i++) await sleep(500);
  if (existsSync(`/proc/${cpid}`)) { try { process.kill(cpid, 'SIGKILL'); } catch { /* */ } await sleep(1500); }
  let cmd = '';
  try { cmd = paneCmd(paneId); } catch { throw new Error('pane closed on kill (team-spawned agent — carry over via its orchestrator); brief was saved to ' + BRIEF); }

  const flags: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--resume') { i++; continue; }
    if (argv[i] === '--continue') continue;
    flags.push(argv[i]);
  }
  const line = `cd ${shq(cwd)} && ${acctEnv.join(' ')} claude ${flags.map(shq).join(' ')}`; // no resume/continue = clean session
  for (let i = 0; i < 8 && !/^(bash|zsh|fish|sh)$/.test(cmd); i++) { await sleep(800); try { cmd = paneCmd(paneId); } catch { break; } }
  execFileSync('tmux', ['send-keys', '-t', paneId, '-l', '--', line]);
  execFileSync('tmux', ['send-keys', '-t', paneId, 'Enter']);

  // Seed the fresh agent once it's booted: read the brief and continue.
  for (let i = 0; i < 12; i++) { await sleep(2000); if (claudePid(panePid)) break; }
  await sleep(4000);
  sendLine(paneId, SEED(BRIEF));
  return { ok: true };
}
