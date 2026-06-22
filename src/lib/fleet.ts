// FleetState contract (shared with server/fleet-probe.ts) + a React polling hook.
//
// The contract is render-agnostic on purpose: today a lightweight DOM town consumes
// it; a future faithful PixiJS port would consume the exact same shape unchanged.
import { useEffect, useRef, useState } from 'react';

export type AgentStatus = 'working' | 'idle' | 'offline';

export interface FleetAgent {
  id: string;          // "01-soul-brews:6.0" (session:window.pane — stable key)
  paneId: string;      // tmux pane id "%NN" — target for capture/send
  session: string;     // tmux session → district / zone
  windowName: string;  // "orchestrator-botlog"
  role: string;        // costume key (see role-costume.ts)
  label: string;       // task / campaign slug — distinguishes duplicate roles
  task: string;        // pane title minus the leading status glyph
  status: AgentStatus;
  glyph: string;       // raw leading glyph of the title (debug + animation phase)
  team: string | null; // campaign plot it belongs to, or null for the commons
  isOrchestrator: boolean;
  ctxPct?: number;     // context window REMAINING (0–100), like brewbot /ctx
  ctxModel?: string;   // model id behind that context window
  waiting?: boolean;   // parked on a TUI menu, blocking on a human answer
  plan?: string;       // Claude account the agent runs on (account-pinned spawn); absent = default
  worktree?: string;   // exact `maw wake --wt <worktree>` value for resume/bookmark; absent = primary checkout
}

export interface FleetTeam {
  name: string;        // campaign / team name (== window slug)
  session: string;     // district it sits in
  members: string[];   // agent ids
  known: boolean;      // backed by ~/.claude/teams/<name>/config.json
  description?: string;
}

export interface FleetRoad {
  from: string;        // orchestrator agent id
  to: string;          // dispatched worker agent id
}

export interface FleetCounts {
  working: number;
  idle: number;
  offline: number;
  teams: number;
  agents: number;
  waiting: number;
}

export interface FleetState {
  ts: string;          // ISO probe timestamp
  host: string;
  agents: FleetAgent[];
  teams: FleetTeam[];
  roads: FleetRoad[];
  counts: FleetCounts;
  error?: string;
}

export const EMPTY_FLEET: FleetState = {
  ts: '', host: '', agents: [], teams: [], roads: [],
  counts: { working: 0, idle: 0, offline: 0, teams: 0, agents: 0, waiting: 0 },
};

// Dedicated path (NOT under /api) so Vite's /api→:47778 proxy never intercepts it,
// and so it stays same-origin (fleet data is local to the host running tmux).
export const FLEET_ENDPOINT = '/__fleet/state';

export async function fetchFleet(signal?: AbortSignal): Promise<FleetState> {
  const res = await fetch(FLEET_ENDPOINT, { signal });
  if (!res.ok) throw new Error(`fleet ${res.status}`);
  return (await res.json()) as FleetState;
}

// Agent text-session endpoints (same-origin, outside /api like FLEET_ENDPOINT).
export const PANE_ENDPOINT = '/__fleet/pane';
export const SEND_ENDPOINT = '/__fleet/send';
export const TRANSCRIPT_ENDPOINT = '/__fleet/transcript';

/** Capture a pane's rendered text (the agent's live terminal screen). */
export async function capturePane(paneId: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${PANE_ENDPOINT}?id=${encodeURIComponent(paneId)}`, { signal });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(j.error || `pane ${res.status}`);
  return j.text as string;
}

/** Full conversation history from the agent's session transcript (deep scrollback). */
export async function fetchTranscript(paneId: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${TRANSCRIPT_ENDPOINT}?id=${encodeURIComponent(paneId)}`, { signal });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(j.error || `transcript ${res.status}`);
  return j.text as string;
}

/** Type a line into the agent's pane and submit it (Enter). */
export async function sendToPane(paneId: string, text: string): Promise<void> {
  await postSend({ id: paneId, text });
}

/** Send a single named navigation key (up/down/left/right/enter/esc/tab) for a TUI menu. */
export async function sendKeyToPane(paneId: string, key: string): Promise<void> {
  await postSend({ id: paneId, key });
}

async function postSend(body: { id: string; text?: string; key?: string }): Promise<void> {
  const res = await fetch(SEND_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `send ${res.status}`);
}

export const CLOSE_ENDPOINT = '/__fleet/close';

/** Close the agent's session (kills its tmux pane — brewbot /close). Destructive. */
export async function closePaneSession(paneId: string): Promise<void> {
  const res = await fetch(CLOSE_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: paneId }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `close ${res.status}`);
}

/** Switch a running agent to another Claude account IN PLACE (keeps its session +
 *  context; server kills→relaunches `claude --resume` under the new config dir). */
export async function switchAgentAccount(paneId: string, planId: string): Promise<void> {
  const res = await fetch('/__fleet/switch-account', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paneId, planId }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `switch ${res.status}`);
}

/** Carry the session over to a FRESH clean session (same agent), briefed via a file
 *  the old session writes — for when context runs low. Server does the in-place swap. */
export async function carryOverSession(paneId: string): Promise<void> {
  const res = await fetch('/__fleet/carry-over', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paneId }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `carry-over ${res.status}`);
}

/** Roles wakeable via `maw wake` (for the New Agent picker). */
export interface AgentPlan { id: string; name: string }
export async function fetchRoles(): Promise<{ roles: string[]; plans: AgentPlan[] }> {
  const res = await fetch('/__fleet/roles');
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(j.error || `roles ${res.status}`);
  return { roles: (j.roles as string[]) ?? [], plans: (j.plans as AgentPlan[]) ?? [] };
}

/** Spawn a new agent (brewbot /new → maw wake). `planId` pins a Claude account. */
export async function newAgent(role: string, slug: string, planId?: string): Promise<string> {
  const res = await fetch('/__fleet/new', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role, slug, planId }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `new ${res.status}`);
  return (j.output as string) ?? '';
}

// ── Bookmarks ────────────────────────────────────────────────────────────────
// Save an agent's resume recipe (role + worktree + account) so you can close its
// session now and RESPAWN it later with its context (`maw wake --wt`, no --fresh).
export interface Bookmark {
  id: string;          // stable key (worktree+role)
  role: string;
  worktree: string;    // exact `maw wake --wt` value
  planId?: string;     // Claude account to re-pin on respawn
  planName?: string;   // display
  label?: string;
  windowName?: string;
  note?: string;
  savedAt: number;
}

export async function listBookmarks(): Promise<Bookmark[]> {
  const res = await fetch('/__fleet/bookmarks');
  const j = await res.json().catch(() => ({}));
  return (j.bookmarks as Bookmark[]) ?? [];
}

/** Bookmark a live agent (server captures role+worktree+account from it). */
export async function addBookmark(agent: FleetAgent, note?: string): Promise<Bookmark> {
  const res = await fetch('/__fleet/bookmarks', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: agent.role, worktree: agent.worktree, planName: agent.plan, label: agent.label, windowName: agent.windowName, note }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `bookmark ${res.status}`);
  return j.bookmark as Bookmark;
}

export async function removeBookmark(id: string): Promise<void> {
  const res = await fetch('/__fleet/bookmarks', {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `unbookmark ${res.status}`);
}

/** Respawn a bookmark — RESUME its session on the same worktree + account. */
export async function respawnBookmark(id: string): Promise<string> {
  const res = await fetch('/__fleet/respawn', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `respawn ${res.status}`);
  return (j.output as string) ?? '';
}

export interface UseFleet {
  state: FleetState;
  loading: boolean;
  error: string | null;
  lastOk: number | null;
}

/** Poll the fleet endpoint every `intervalMs` (default 2s). */
export function useFleet(intervalMs = 2000): UseFleet {
  const [state, setState] = useState<FleetState>(EMPTY_FLEET);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    const ac = new AbortController();
    async function tick() {
      try {
        const s = await fetchFleet(ac.signal);
        if (!alive) return;
        setState(s);
        setError(s.error ?? null);
        setLastOk(Date.now());
      } catch (e) {
        if (alive && (e as Error).name !== 'AbortError') setError((e as Error).message);
      } finally {
        if (alive) {
          setLoading(false);
          timer.current = setTimeout(tick, intervalMs);
        }
      }
    }
    tick();
    return () => {
      alive = false;
      ac.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [intervalMs]);

  return { state, loading, error, lastOk };
}
