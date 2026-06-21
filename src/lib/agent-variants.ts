// Per-agent sprite VARIANT override. Each folk-sprite index (0–31) is a distinct
// body+hue, so picking one recolors ONE agent on the map without touching its role
// (the role still drives the default). Stored in localStorage keyed by a stable
// agent key (role + slug), mirroring zone-textures. variantFor() falls back to the
// role's default sprite when no override is set.
import { charIndexFor } from './role-costume';

const LS = 'town:agent-variants';
export const VARIANT_COUNT = 32;

type AgentLike = { role: string; label?: string; windowName?: string };

// Stable across respawns: role+slug when the agent has a real slug, else the window
// name. (The numeric pane/worktree id changes on respawn; the slug/window doesn't.)
export function variantKey(a: AgentLike): string {
  return a.label && a.label !== 'oracle' ? `${a.role}:${a.label}` : (a.windowName || a.role);
}

export function loadVariants(): Record<string, number> {
  try { const v = JSON.parse(localStorage.getItem(LS) || '{}'); return v && typeof v === 'object' ? v : {}; }
  catch { return {}; }
}
function saveVariants(m: Record<string, number>): void {
  try { localStorage.setItem(LS, JSON.stringify(m)); } catch { /* ignore */ }
}

/** The chosen sprite index for an agent, or its role default. */
export function variantFor(a: AgentLike): number {
  const m = loadVariants(); const k = variantKey(a);
  return k in m ? m[k] : charIndexFor(a.role);
}

/** Set (idx 0–31) or clear (null = back to role default) an agent's variant. */
export function setVariant(a: AgentLike, idx: number | null): void {
  const m = loadVariants(); const k = variantKey(a);
  if (idx == null) delete m[k]; else m[k] = idx;
  saveVariants(m);
}
