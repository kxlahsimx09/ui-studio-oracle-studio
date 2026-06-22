// Switch a RUNNING agent to a different Claude account IN PLACE, keeping its session.
// The naive "spawn fresh + close old" loses the conversation AND can orphan the agent
// if the fresh spawn fails. Instead we: find the pane's claude, read its session +
// flags, KILL it (stops transcript writes), COPY its transcript into the new account's
// config dir (transcripts live per-config-dir, so --resume only finds it there), then
// relaunch `claude --resume <session>` in the SAME pane under the new CLAUDE_CONFIG_DIR.
// Billing follows the config dir, so the agent now bills the new account with full context.
import { execFileSync } from 'node:child_process';
import { readFileSync, readlinkSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { planById, planConfigDir } from './usage';
import { ensureAccountDir } from './account-dirs';

const HOME = homedir();
const DEFAULT_DIR = join(HOME, '.claude');
const encode = (cwd: string) => cwd.replace(/[/.]/g, '-');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

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

function newestSessionId(projDir: string): string | null {
  let best: { id: string; m: number } | null = null;
  try {
    for (const f of readdirSync(projDir)) {
      if (!f.endsWith('.jsonl')) continue;
      const m = statSync(join(projDir, f)).mtimeMs;
      if (!best || m > best.m) best = { id: f.slice(0, -'.jsonl'.length), m };
    }
  } catch { return null; }
  return best?.id ?? null;
}

const paneCmd = (pane: string) => execFileSync('tmux', ['display', '-p', '-t', pane, '#{pane_current_command}'], { encoding: 'utf8' }).trim();

/** Switch the agent in `paneId` to account `planId`, preserving its session + context. */
export async function switchAccount(paneId: string, planId: string): Promise<{ ok: boolean }> {
  if (!/^%\d+$/.test(paneId)) throw new Error('bad pane id');
  const plan = planById(planId);
  if (!plan) throw new Error(`unknown plan: ${planId}`);
  const newDir = planConfigDir(plan) || DEFAULT_DIR; // passthrough/default → ~/.claude

  const panePid = Number(execFileSync('tmux', ['display', '-p', '-t', paneId, '#{pane_pid}'], { encoding: 'utf8' }).trim());
  const cpid = claudePid(panePid);
  if (!cpid) throw new Error('no running claude in that pane — open/resume the agent first');

  const cwd = readlinkSync(`/proc/${cpid}/cwd`);
  const env = readFileSync(`/proc/${cpid}/environ`, 'utf8').split('\0');
  const oldDir = (env.find((kv) => kv.startsWith('CLAUDE_CONFIG_DIR=')) || '').slice('CLAUDE_CONFIG_DIR='.length) || DEFAULT_DIR;
  if (oldDir === newDir) return { ok: true }; // already on this account
  const teamEnv = env.filter((kv) => /^(CLAUDECODE|CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS)=/.test(kv));
  const argv = readFileSync(`/proc/${cpid}/cmdline`, 'utf8').split('\0').filter(Boolean); // [claude, ...flags]

  const enc = encode(cwd);
  const sid = newestSessionId(join(oldDir, 'projects', enc)); // current session to carry over
  if (newDir !== DEFAULT_DIR) ensureAccountDir(newDir);       // bring MCP/hooks/trust so it boots clean

  // Kill the claude (stops transcript writes) — keep the pane's shell to relaunch into.
  try { process.kill(cpid, 'SIGTERM'); } catch { /* */ }
  for (let i = 0; i < 12 && existsSync(`/proc/${cpid}`); i++) await sleep(500);
  if (existsSync(`/proc/${cpid}`)) { try { process.kill(cpid, 'SIGKILL'); } catch { /* */ } await sleep(1500); }

  // Pane must survive as a shell (maw-wake agents). Team-spawned panes die on kill.
  let cmd = '';
  try { cmd = paneCmd(paneId); } catch { throw new Error('pane closed when the agent stopped — this agent can\'t switch in place (team-spawned; switch via its orchestrator)'); }

  // Carry the transcript into the new account's config dir so --resume finds it.
  if (sid) {
    const src = join(oldDir, 'projects', enc, `${sid}.jsonl`);
    const dstDir = join(newDir, 'projects', enc);
    try { mkdirSync(dstDir, { recursive: true }); copyFileSync(src, join(dstDir, `${sid}.jsonl`)); } catch { /* best-effort */ }
  }

  // Rebuild the launch: original flags minus any resume/continue, + --resume <sid>.
  const flags: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--resume') { i++; continue; } // drop flag + its value
    if (argv[i] === '--continue') continue;
    flags.push(argv[i]);
  }
  const envPrefix = [...teamEnv, `CLAUDE_CONFIG_DIR=${newDir}`].join(' ');
  const line = `cd ${shq(cwd)} && ${envPrefix} claude ${flags.map(shq).join(' ')}${sid ? ` --resume ${sid}` : ''}`;

  for (let i = 0; i < 8 && !/^(bash|zsh|fish|sh)$/.test(cmd); i++) { await sleep(800); try { cmd = paneCmd(paneId); } catch { break; } }
  execFileSync('tmux', ['send-keys', '-t', paneId, '-l', '--', line]);
  execFileSync('tmux', ['send-keys', '-t', paneId, 'Enter']);
  return { ok: true };
}
