// Staging sync/readiness probe for the Fleet Town HUD. Runs the gateway's
// READ-ONLY verify-staging.sh (which delegates currency to stack-freshness.sh)
// and parses its per-substrate lines into a small structured set the HUD shows
// as green/amber/red dots: are migrations / edge-functions / cf-worker / admin-UI
// in sync with main, and are the readiness probes live?
//
// Cached: one run at a time; the HUD polls the cached result and triggers a fresh
// run at most every ~60s (read-only, but it hits the Supabase Mgmt API + Vercel).
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';

const GATEWAY = join(homedir(), 'Code/github.com/kxlahsimx09/mb-next-payment-gateway');
const SCRIPT = join(GATEWAY, 'scripts/verify-staging.sh');

function runEnv(): Record<string, string> {
  const extra = [join(homedir(), '.bun/bin'), join(homedir(), '.local/bin'), join(homedir(), 'go/bin')];
  return { ...process.env, PATH: [...extra, process.env.PATH || ''].filter(Boolean).join(':') } as Record<string, string>;
}

export type CheckState = 'ok' | 'stale' | 'fail' | 'warn' | 'unknown' | 'skipped';
export interface VerifyCheck { label: string; state: CheckState; detail: string }
export interface VerifyState {
  status: 'idle' | 'running' | 'done';
  ranAt?: number; exitCode?: number | null;
  checks: VerifyCheck[];
  verdict?: string;   // final VERDICT line
  ok?: boolean;       // exit 0 = READY/CURRENT
}

// label as printed by verify-staging.sh / stack-freshness.sh → friendly name
const LABELS: Record<string, string> = {
  'migrations': 'Migrations',
  'edge-funcs': 'Edge functions',
  'cf-worker': 'CF worker',
  'admin-ui': 'Admin UI · currency',
  'deposits-create': 'deposits-create EF',
  'clock/reset rpcs': 'Clock / reset RPCs',
  'admin-ui alias': 'Admin UI · alias',
};

function classify(v: string): CheckState {
  const u = v.toUpperCase();
  if (u.includes('STALE') || u.includes('MISSING')) return 'stale';
  if (u.includes('FAIL')) return 'fail';
  if (u.includes('SKIP')) return 'skipped';
  if (u.includes('UNKNOWN')) return 'unknown';
  if (u.includes('WARN')) return 'warn';
  if (u.startsWith('OK') || u.includes('CURRENT')) return 'ok';
  return 'unknown';
}

function parse(log: string[]): { checks: VerifyCheck[]; verdict?: string } {
  const map = new Map<string, VerifyCheck>();
  let verdict: string | undefined;
  for (const line of log) {
    const v = line.match(/^VERDICT:\s*(.+)$/);
    if (v) { verdict = v[1].trim(); continue; }
    const m = line.match(/^\s*([A-Za-z0-9/_ -]+?)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const name = LABELS[key];
    if (!name) continue;
    map.set(name, { label: name, state: classify(m[2]), detail: m[2].trim() }); // last line wins
  }
  return { checks: [...map.values()], verdict };
}

let state: VerifyState = { status: 'idle', checks: [] };

export const getVerify = (): VerifyState => state;

/** Trigger a verify run. Throttled: a fresh-enough cached result is reused
 *  unless force=true (the HUD's manual ⟳). */
export function runVerify(force = false): { ok: true } | { error: string } | { cached: true } {
  if (state.status === 'running') return { ok: true };
  if (!force && state.ranAt && Date.now() - state.ranAt < 20_000) return { cached: true };
  if (!existsSync(SCRIPT)) return { error: `verify script not found: ${SCRIPT}` };
  const log: string[] = [];
  state = { ...state, status: 'running' }; // keep prior checks visible while re-running
  let proc: ChildProcess;
  try { proc = spawn('bash', [SCRIPT, 'staging'], { cwd: GATEWAY, env: runEnv() }); }
  catch (e) { state = { ...state, status: 'done' }; return { error: (e as Error).message }; }
  const onData = (b: Buffer) => b.toString().split('\n').forEach((l) => { if (l) log.push(l); });
  proc.stdout?.on('data', onData);
  proc.stderr?.on('data', onData);
  proc.on('close', (code) => {
    const { checks, verdict } = parse(log);
    state = { status: 'done', ranAt: Date.now(), exitCode: code, checks, verdict, ok: code === 0 };
  });
  return { ok: true };
}
