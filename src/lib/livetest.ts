// Poll the live-tester suite catalog + current run, and launch/cancel runs.
// GET /__fleet/livetest = { suites, run }; POST {suite,env,campaign} launches
// (lock-aware), POST {action:'cancel'} kills the active run.
import { useEffect, useRef, useState } from 'react';

// A card from the v2 journey catalog JSON (server reads it from the agent's repo).
export interface Suite {
  id: string; label: string; title: string;
  command: string; speed: string;          // FAST | SLOW | OTHER
  epic?: string; state?: string; result?: string | null;
  runnable: boolean; reason?: string;       // not_runnable_reason
  ownerGated?: boolean; ownerGoEnv?: string;
  optionalEnv?: { name: string; description?: string }[];
  cast?: string;
  batch?: boolean;   // a run-catalog.sh "run everything" entry, not a single card
}
export interface ProgItem {
  id: string; speed?: string; redfirst?: boolean;
  status: 'pending' | 'running' | 'done';
  rc?: number; summary?: string; color?: 'green' | 'amber' | 'red';
}
export interface RunState {
  status: 'idle' | 'running' | 'done';
  suite?: string; campaign?: string; startedAt?: number; endedAt?: number;
  exitCode?: number | null; log: string[]; progress?: ProgItem[];
  legs?: unknown; evidenceDir?: string; error?: string;
}
export interface CatalogSummary { total_cards?: number; runnable?: number; green?: number;
  by_speed?: Record<string, number>; fast_regression_roster?: string[] }
export interface LiveTest { suites: Suite[]; summary?: CatalogSummary | null; run: RunState }

export function useLiveTest(open: boolean, paneId?: string): { data: LiveTest | null; reload: () => void } {
  const [data, setData] = useState<LiveTest | null>(null);
  const tick = useRef<() => void>(() => {});
  const url = `/__fleet/livetest${paneId ? `?pane=${encodeURIComponent(paneId)}` : ''}`;
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () => fetch(url).then((r) => r.json()).then((d) => { if (alive) setData(d); }).catch(() => {});
    tick.current = load;
    load();
    const id = setInterval(() => { const running = data?.run?.status === 'running'; if (running || !data) load(); }, 2000);
    const slow = setInterval(load, 8000);
    return () => { alive = false; clearInterval(id); clearInterval(slow); };
  }, [open, url, data?.run?.status]);
  return { data, reload: () => tick.current() };
}

export async function runSuite(suite: string, env: Record<string, unknown>, campaign: string, paneId?: string): Promise<{ held?: unknown; error?: string; ok?: boolean }> {
  const res = await fetch('/__fleet/livetest', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ suite, env, campaign, paneId }),
  });
  return res.json().catch(() => ({ error: `run ${res.status}` }));
}
export async function cancelRun(): Promise<void> {
  await fetch('/__fleet/livetest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) }).catch(() => {});
}
/** Bring latest origin/main into the opened agent's repo (worktree), or the
 *  primary checkout when no pane (the main-repo run menu). */
export async function pullMainRepo(paneId?: string): Promise<{ ok?: boolean; output?: string; error?: string }> {
  const res = await fetch('/__fleet/livetest', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'pull-main', paneId }),
  });
  return res.json().catch(() => ({ error: `pull ${res.status}` }));
}
