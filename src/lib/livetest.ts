// Poll the live-tester suite catalog + current run, and launch/cancel runs.
// GET /__fleet/livetest = { suites, run }; POST {suite,env,campaign} launches
// (lock-aware), POST {action:'cancel'} kills the active run.
import { useEffect, useRef, useState } from 'react';

export interface LegInfo { id: string; title?: string; ac?: string; what: string; why: string; how: string; verify: string }
export interface Control {
  env: string; label: string; type: 'toggle' | 'number' | 'text' | 'select';
  def?: string; options?: string[]; help?: string; danger?: boolean;
  info?: LegInfo[];   // per-leg What/Why/How/Verify for the ⓘ popover (server-enriched)
}
export interface Suite {
  id: string; label: string; launcher: string; runtime: string; gate: string;
  ownerGated?: boolean; controls: Control[];
}
export interface RunState {
  status: 'idle' | 'running' | 'done';
  suite?: string; campaign?: string; startedAt?: number; endedAt?: number;
  exitCode?: number | null; log: string[]; legs?: unknown; evidenceDir?: string; error?: string;
}
export interface LiveTest { suites: Suite[]; globals: Control[]; run: RunState }

export function useLiveTest(open: boolean): { data: LiveTest | null; reload: () => void } {
  const [data, setData] = useState<LiveTest | null>(null);
  const tick = useRef<() => void>(() => {});
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () => fetch('/__fleet/livetest').then((r) => r.json()).then((d) => { if (alive) setData(d); }).catch(() => {});
    tick.current = load;
    load();
    // poll fast while a run streams, slow otherwise
    const id = setInterval(() => { const running = data?.run?.status === 'running'; if (running || !data) load(); }, 2000);
    const slow = setInterval(load, 8000);
    return () => { alive = false; clearInterval(id); clearInterval(slow); };
  }, [open, data?.run?.status]);
  return { data, reload: () => tick.current() };
}

export async function runSuite(suite: string, env: Record<string, unknown>, campaign: string): Promise<{ held?: unknown; error?: string; ok?: boolean }> {
  const res = await fetch('/__fleet/livetest', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ suite, env, campaign }),
  });
  return res.json().catch(() => ({ error: `run ${res.status}` }));
}
export async function cancelRun(): Promise<void> {
  await fetch('/__fleet/livetest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) }).catch(() => {});
}
