// Client side of the staging deploy runner (server: /__fleet/deploy).
// GET = current run state (streamed log); POST launches a deploy slice, pulls
// main on both repos, or cancels. Poll fast while a run streams.
import { useEffect, useRef, useState } from 'react';

export type DeployMode = 'full' | 'ui';
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

async function post(body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch(ENDPOINT, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ error: `deploy ${res.status}` }));
}

export const startDeploy = (mode: DeployMode, dry: boolean, pull: boolean) => post({ action: 'deploy', mode, dry, pull });
export const pullMain = () => post({ action: 'pull-main' });
export const cancelDeploy = () => post({ action: 'cancel' });
