// Client side of per-agent notes (server: /__fleet/agent-notes). Keyed by the
// stable tmux pane id. Exposed as a { pane → note } map for O(1) lookup in render.
import { useEffect, useRef, useState } from 'react';

export interface AgentNote { pane: string; note: string; savedAt: number }

const ENDPOINT = '/__fleet/agent-notes';

export async function saveNote(pane: string, note: string): Promise<void> {
  const res = await fetch(ENDPOINT, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pane, note }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `notes ${res.status}`);
}

export async function deleteNote(pane: string): Promise<void> {
  const res = await fetch(ENDPOINT, {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pane }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `notes ${res.status}`);
}

/** Poll notes; expose them as a { pane → note } map + a manual reload. */
export function useAgentNotes(intervalMs = 4000): { notes: Record<string, string>; reload: () => void } {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const aliveRef = useRef(true);
  const load = () => fetch(ENDPOINT).then((r) => r.json()).then((j) => {
    if (!aliveRef.current) return;
    const map: Record<string, string> = {};
    for (const n of (j.notes as AgentNote[]) ?? []) map[n.pane] = n.note;
    setNotes(map);
  }).catch(() => {});
  useEffect(() => {
    aliveRef.current = true;
    load();
    const id = setInterval(load, intervalMs);
    return () => { aliveRef.current = false; clearInterval(id); };
  }, [intervalMs]);
  return { notes, reload: load };
}
