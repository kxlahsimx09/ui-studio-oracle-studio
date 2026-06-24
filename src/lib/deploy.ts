// Client side of the staging deploy runner (server: /__fleet/deploy).
// GET = current run state (streamed log); POST launches a deploy slice, pulls
// main on both repos, or cancels. Poll fast while a run streams.
import { useEffect, useRef, useState } from 'react';

export type DeployMode = 'full' | 'ui' | 'migrations' | 'ef' | 'bankbot';
export interface DeployState {
  status: 'idle' | 'running' | 'done';
  action?: string;
  startedAt?: number; endedAt?: number;
  exitCode?: number | null;
  log: string[];
}

const ENDPOINT = '/__fleet/deploy';

export function useDeploy(open: boolean): { run: DeployState | null; reload: () => void } {
  const [run, setRun] = useState<DeployState | null>(null);
  const tick = useRef<() => void>(() => {});
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () => fetch(ENDPOINT).then((r) => r.json()).then((d) => { if (alive) setRun(d); }).catch(() => {});
    tick.current = load;
    load();
    const id = setInterval(load, 1500); // steady poll while the panel is open
    return () => { alive = false; clearInterval(id); };
  }, [open]);
  return { run, reload: () => tick.current() };
}

/** Lightweight poll of just the deploy run status — for the header rocket
 *  animation, which must react even while the panel is closed. */
export function useDeployRunning(pollMs = 3000): boolean {
  const [running, setRunning] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(ENDPOINT).then((r) => r.json()).then((d: DeployState) => { if (alive) setRunning(d?.status === 'running'); }).catch(() => {});
    load();
    const id = setInterval(load, pollMs);
    return () => { alive = false; clearInterval(id); };
  }, [pollMs]);
  return running;
}

export type DeployFx = 'launch' | 'fall' | null;
/** Poll deploy status AND emit a one-shot effect when a run finishes: 'launch'
 *  on success (exit 0), 'fall' on failure — for the statue's rocket/topple. */
export function useDeploySignal(pollMs = 2500): { deploying: boolean; fx: DeployFx } {
  const [deploying, setDeploying] = useState(false);
  const [fx, setFx] = useState<DeployFx>(null);
  const prev = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(ENDPOINT).then((r) => r.json()).then((d: DeployState) => {
      if (!alive) return;
      setDeploying(d?.status === 'running');
      if (prev.current === 'running' && d?.status === 'done') {
        const f: DeployFx = d.exitCode === 0 ? 'launch' : 'fall';
        setFx(f);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => { if (alive) setFx(null); }, f === 'launch' ? 2700 : 9000);
      }
      prev.current = d?.status;
    }).catch(() => {});
    load();
    const id = setInterval(load, pollMs);
    return () => { alive = false; clearInterval(id); clearTimeout(timer.current); };
  }, [pollMs]);
  return { deploying, fx };
}

async function post(body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch(ENDPOINT, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ error: `deploy ${res.status}` }));
}

export const startDeploy = (
  mode: DeployMode, dry: boolean, pull: boolean, allowDirty: boolean, skipGate: boolean,
) => post({ action: 'deploy', mode, dry, pull, allowDirty, skipGate });
export const pullMain = () => post({ action: 'pull-main' });
export const cancelDeploy = () => post({ action: 'cancel' });
