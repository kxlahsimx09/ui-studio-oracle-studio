// Per-agent COLOUR override — a CSS hue-rotation applied to the agent's map sprite,
// so you can make ONE agent visually distinct by colour without changing its role.
// (The folk spritesheet's built-in variants only span 4 palette bands, so adjacent
// ones look alike; a hue-rotate gives the full, clearly-distinct spectrum.)
// Stored in localStorage keyed by a stable agent key (role+slug). Absent = role
// default colour (no rotation).
const LS = 'town:agent-hues';

type AgentLike = { role: string; label?: string; windowName?: string };

// Evenly-spaced, clearly-distinct hue-rotate degrees offered in the picker.
export const HUES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

// Stable across respawns: role+slug when the agent has a real slug, else the window
// name (the numeric pane/worktree id changes on respawn; the slug/window doesn't).
export function agentKey(a: AgentLike): string {
  return a.label && a.label !== 'oracle' ? `${a.role}:${a.label}` : (a.windowName || a.role);
}

export function loadHues(): Record<string, number> {
  try { const v = JSON.parse(localStorage.getItem(LS) || '{}'); return v && typeof v === 'object' ? v : {}; }
  catch { return {}; }
}
function saveHues(m: Record<string, number>): void {
  try { localStorage.setItem(LS, JSON.stringify(m)); } catch { /* ignore */ }
}

/** The chosen hue-rotate degree for an agent, or null (role default colour). */
export function agentHue(a: AgentLike): number | null {
  const m = loadHues(); const k = agentKey(a);
  return k in m ? m[k] : null;
}

/** Set a hue (deg) or clear (null = back to role default) for one agent. */
export function setAgentHue(a: AgentLike, deg: number | null): void {
  const m = loadHues(); const k = agentKey(a);
  if (deg == null) delete m[k]; else m[k] = deg;
  saveHues(m);
}
