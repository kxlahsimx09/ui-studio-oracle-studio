// Poll + control the staging-env lock (/__fleet/lock). One agent at a time may
// drive the shared staging env; the holder.tmux_pane lets PixelTown attach the
// env item to that agent's sprite. The owner can force-release or toggle the
// global "disabled" (no-lock) mode from the UI.
import { useEffect, useState } from 'react';

export interface LockHolder {
  agent: string; campaign: string | null; reason: string | null;
  tmux_pane: string | null; worktree: string; host: string; pid: number;
  acquired_at: string; acquired_epoch: number;
}
export interface LockState {
  name: string; locked: boolean; disabled: boolean; holder: LockHolder | null;
}

export function useLock(intervalMs = 4000): LockState | null {
  const [lock, setLock] = useState<LockState | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => fetch('/__fleet/lock').then((r) => r.json()).then((d) => { if (alive) setLock(d); }).catch(() => {});
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(id); };
  }, [intervalMs]);
  return lock;
}

async function act(action: 'release' | 'disable' | 'enable'): Promise<LockState> {
  const res = await fetch('/__fleet/lock', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `lock ${res.status}`);
  return j.lock as LockState;
}
export const releaseLock = () => act('release');
export const disableLock = () => act('disable');
export const enableLock = () => act('enable');
