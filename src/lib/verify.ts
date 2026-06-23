// Client side of the staging sync HUD (server: /__fleet/verify). Polls the cached
// verify-staging result and, while the town is open, triggers a fresh run roughly
// every 60s (the server throttles, and a shared ranAt dedupes across viewers).
import { useEffect, useRef, useState } from 'react';

export type CheckState = 'ok' | 'stale' | 'fail' | 'warn' | 'unknown' | 'skipped';
export interface VerifyCheck { label: string; state: CheckState; detail: string }
export interface VerifyState {
  status: 'idle' | 'running' | 'done';
  ranAt?: number; exitCode?: number | null;
  checks: VerifyCheck[];
  verdict?: string;
  ok?: boolean;
}

const ENDPOINT = '/__fleet/verify';
const REFRESH_MS = 60_000; // re-run verify at most this often

async function post(force: boolean): Promise<void> {
  try {
    await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ force }) });
  } catch { /* ignore */ }
}

export function useVerify(): { state: VerifyState | null; refresh: () => void } {
  const [state, setState] = useState<VerifyState | null>(null);
  const ref = useRef<VerifyState | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(ENDPOINT).then((r) => r.json()).then((s) => { if (alive) { setState(s); ref.current = s; } }).catch(() => {});
    const maybeRun = () => {
      const s = ref.current;
      const stale = !s?.ranAt || Date.now() - s.ranAt > REFRESH_MS;
      if (s?.status !== 'running' && stale) post(false);
    };
    load(); maybeRun();
    const poll = setInterval(load, 4000);
    const auto = setInterval(maybeRun, 15_000); // checks staleness → a run fires ~every 60s
    return () => { alive = false; clearInterval(poll); clearInterval(auto); };
  }, []);
  return { state, refresh: () => post(true) };
}
