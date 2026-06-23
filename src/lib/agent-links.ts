// Client side of the agent "who waits for whom" links (server: /__fleet/links).
// A link is a visual-only arrow A→B with a note, drawn drag-and-drop in PixelTown.
// Persisted server-side so the same wiring shows up on desktop and phone.
import { useEffect, useRef, useState } from 'react';

export interface AgentLink {
  id: string;
  from: string;
  to: string;
  note: string;
  savedAt: number;
}

const ENDPOINT = '/__fleet/links';

export async function fetchLinks(signal?: AbortSignal): Promise<AgentLink[]> {
  const res = await fetch(ENDPOINT, { signal });
  if (!res.ok) throw new Error(`links ${res.status}`);
  const j = (await res.json()) as { links?: AgentLink[] };
  return j.links ?? [];
}

export async function saveLink(from: string, to: string, note: string): Promise<void> {
  const res = await fetch(ENDPOINT, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, note }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `links ${res.status}`);
}

export async function deleteLink(id: string): Promise<void> {
  const res = await fetch(ENDPOINT, {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `links ${res.status}`);
}

/** Poll the links and expose a manual reload (called right after save/delete so
 *  the new arrow shows immediately instead of waiting for the next poll). */
export function useAgentLinks(intervalMs = 4000): { links: AgentLink[]; reload: () => void } {
  const [links, setLinks] = useState<AgentLink[]>([]);
  const aliveRef = useRef(true);
  const load = () => fetchLinks().then((l) => { if (aliveRef.current) setLinks(l); }).catch(() => {});
  useEffect(() => {
    aliveRef.current = true;
    load();
    const id = setInterval(load, intervalMs);
    return () => { aliveRef.current = false; clearInterval(id); };
  }, [intervalMs]);
  return { links, reload: load };
}

/** Box hit-test: which agent sprite (other than `excludeId`) sits under the point
 *  (stage-relative px)? Used on drop to turn "drag A onto B" into a link. */
export function hitTestAgent(
  boxes: Array<{ id: string; x: number; y: number; size: number }>,
  x: number, y: number, excludeId: string,
): string | null {
  for (const b of boxes) {
    if (b.id === excludeId) continue;
    if (x >= b.x && x <= b.x + b.size && y >= b.y && y <= b.y + b.size) return b.id;
  }
  return null;
}
