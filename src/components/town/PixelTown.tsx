// Pixel-sprite town (ai-town style): each agent is a folk sprite that wanders its
// zone with a walk-cycle when working, stands with a 💤 when idle, fades when
// offline. Districts/plots are fenced zones on a grass map; dispatch roads link
// orchestrators to the workers they spawned. Same /__fleet/state data as the list view.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { FleetState, FleetAgent } from '../../lib/fleet';
import type { LockState } from '../../lib/lock';
import { groupTown } from '../../lib/town-group';
import { buildStage } from '../../lib/town-stage';
import { costumeFor, charIndexFor, ctxColor, activityEmoji } from '../../lib/role-costume';
import { agentHue } from '../../lib/agent-variants';
import { SHEET_URL, SHEET_W, SHEET_H, SPRITE, bgPos } from '../../lib/sprite';
import { buildProps } from '../../lib/town-props';
import { loadZoneTextures, saveZoneTextures, textureById } from '../../lib/textures';
import { TexturePicker } from './TexturePicker';
import { AgentLinks } from './AgentLinks';
import type { PendingLink } from './AgentLinks';
import { saveLink, deleteLink, hitTestAgent } from '../../lib/agent-links';
import type { AgentLink } from '../../lib/agent-links';
import { AgentNoteEditor } from './AgentNoteEditor';
import type { NotePending } from './AgentNoteEditor';
import { saveNote, deleteNote } from '../../lib/agent-notes';

interface Actor {
  id: string; x: number; y: number; tx: number; ty: number;
  dir: number; frame: number; frameT: number; waitT: number;
  status: string; charIndex: number; home: { x: number; y: number; w: number; h: number };
  pinned?: boolean; // dragged to a fixed spot — stops wandering / re-clamping
  paneId?: string;  // stable tmux pane id — to match links/notes
  idleSince?: number; // ms when it last stopped working (for the linked-stall aura)
}
const IDLE_AURA_MS = 60_000; // linked agent idle this long → stall aura

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const DRAG_PAUSE_MS = 2000; // after a drop, the sprite stands here this long, then wanders on

function pickTarget(a: Actor) {
  a.tx = rnd(a.home.x, a.home.x + Math.max(1, a.home.w - SPRITE));
  a.ty = rnd(a.home.y, a.home.y + Math.max(1, a.home.h - SPRITE));
  a.waitT = rnd(300, 1600); // pause on arrival
}

export function PixelTown(
  { state, onSelect, lock, onLockClick, links = [], reloadLinks, notes = {}, reloadNotes, stagingOutOfSync = false, deploying = false }:
  { state: FleetState; onSelect: (a: FleetAgent) => void; lock?: LockState | null; onLockClick?: () => void;
    links?: AgentLink[]; reloadLinks?: () => void;
    notes?: Record<string, string>; reloadNotes?: () => void; stagingOutOfSync?: boolean; deploying?: boolean },
) {
  const districts = useMemo(() => groupTown(state), [state]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1180);
  const stage = useMemo(() => buildStage(districts, width), [districts, width]);
  const props = useMemo(() => buildProps(stage), [stage]);
  const [zoneTex, setZoneTex] = useState<Record<string, string>>(loadZoneTextures);
  const [picking, setPicking] = useState<{ id: string; label: string } | null>(null);
  const actors = useRef<Map<string, Actor>>(new Map());
  const els = useRef<Map<string, HTMLDivElement>>(new Map());
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; sx: number; sy: number; moved: boolean } | null>(null);
  // Agent dependency arrows: the rAF moves each line + note pill to follow the two
  // live sprites it connects, so the refs (not React) hold the per-frame positions.
  const linkLineEls = useRef<Map<string, SVGLineElement>>(new Map());
  const linkLabelEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const linksRef = useRef<AgentLink[]>(links);
  // Panes at an ARROWHEAD (`to`) get the stall aura; panes at the TAIL (`from`)
  // are the waiters — they're meant to be idle, so they get NO aura and their
  // native waiting/working pulse is calmed (the link already says they're waiting).
  const linkTargetPanesRef = useRef<Set<string>>(new Set());
  const linkSourcePanesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    linksRef.current = links;
    linkTargetPanesRef.current = new Set(links.map((l) => l.toPane).filter(Boolean));
    linkSourcePanesRef.current = new Set(links.map((l) => l.fromPane).filter(Boolean));
  }, [links]);
  // Live agents, for the rAF: links resolve their endpoints by the STABLE tmux pane
  // id (%NN, never reused), not the positional `id` (session:window.pane) — that
  // slot gets reused when an agent disappears, which made arrows jump to whoever
  // moved into the freed id.
  const agentsRef = useRef(state.agents);
  useEffect(() => { agentsRef.current = state.agents; }, [state.agents]);
  const [pending, setPending] = useState<PendingLink | null>(null);
  const [notePending, setNotePending] = useState<NotePending | null>(null);
  const labelFor = (a: FleetAgent) => {
    const title = costumeFor(a.role).title;
    return a.label && a.label !== 'oracle' ? `${title}·${a.label}` : title;
  };
  // Display label for an agent id (costume title · slug) — used in the link editor.
  const nameOf = (id: string) => {
    const a = state.agents.find((x) => x.id === id);
    return a ? labelFor(a) : id;
  };
  // Same, but matched on the stable pane id (for editing a saved link whose
  // positional id may have changed since it was drawn).
  const nameOfPane = (pane: string, fallback: string) => {
    const a = state.agents.find((x) => x.paneId === pane);
    return a ? labelFor(a) : fallback;
  };
  // Animated decorations (campfire/windmill/sparkle): the rAF cycles their frames.
  const propEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const animState = useRef<Map<string, { frame: number; t: number }>>(new Map());
  const animsRef = useRef(props.anims);
  const reduceRef = useRef(false);
  // Staging-env lock item — a 🔒 marker that trails the holder's sprite (matched
  // by tmux pane id). Parks bottom-left when the holder isn't on the map.
  const holderId = useMemo(() => {
    const pane = lock?.locked ? lock.holder?.tmux_pane : null;
    return pane ? state.agents.find((a) => a.paneId === pane)?.id ?? null : null;
  }, [lock, state]);
  const lockEl = useRef<HTMLDivElement>(null);
  const lockRef = useRef<{ holderId: string | null; active: boolean }>({ holderId: null, active: false });
  useEffect(() => { lockRef.current = { holderId, active: !!lock?.locked }; }, [holderId, lock]);

  // Drag a sprite to reposition it (separate overlapping agents); a no-move
  // press is treated as a click → open the chat. Dragged actors are pinned.
  const onDown = (e: ReactPointerEvent<HTMLDivElement>, a: FleetAgent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: a.id, sx: e.clientX, sy: e.clientY, moved: false };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
    d.moved = true;
    const act = actors.current.get(d.id);
    const st = stageRef.current;
    if (!act || !st) return;
    const r = st.getBoundingClientRect();
    act.pinned = true;
    act.x = clamp(e.clientX - r.left - SPRITE / 2, 0, Math.max(0, r.width - SPRITE));
    act.y = clamp(e.clientY - r.top - SPRITE / 2, 0, Math.max(0, r.height - SPRITE));
    const el = els.current.get(d.id);
    if (el) el.style.transform = `translate(${act.x}px, ${act.y}px)`;
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>, a: FleetAgent) => {
    const d = drag.current;
    drag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!d || d.id !== a.id) return;
    if (!d.moved) { onSelect(a); return; } // a press without movement = click → open chat
    // Dropped ONTO another sprite → record "A waits on B" and open the note editor.
    const st = stageRef.current;
    if (st) {
      const r = st.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const boxes = [...actors.current.values()].map((ac) => ({ id: ac.id, x: ac.x, y: ac.y, size: SPRITE }));
      const targetId = hitTestAgent(boxes, px, py, a.id);
      const target = targetId ? state.agents.find((x) => x.id === targetId) : null;
      if (target) setPending({
        from: a.id, to: target.id, fromPane: a.paneId, toPane: target.paneId,
        fromLabel: nameOf(a.id), toLabel: nameOf(target.id), note: '',
      });
    }
    // Dropped after a drag: don't freeze it — pause where it landed, then wander on.
    const act = actors.current.get(a.id);
    if (act) { act.pinned = false; act.waitT = DRAG_PAUSE_MS; act.frame = 0; }
  };

  // Fill the available width — the walking area grows with the viewport.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0].contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reconcile actor state with the current placements (add/update/remove).
  useEffect(() => {
    const live = new Set<string>();
    for (const a of state.agents) {
      const place = stage.placements[a.id];
      if (!place) continue;
      live.add(a.id);
      const home = place.home;
      let act = actors.current.get(a.id);
      if (!act) {
        act = { id: a.id, x: rnd(home.x, home.x + home.w - SPRITE), y: rnd(home.y, home.y + home.h - SPRITE), tx: 0, ty: 0, dir: 0, frame: 0, frameT: 0, waitT: rnd(0, 800), status: a.status, charIndex: charIndexFor(a.role), home, paneId: a.paneId };
        pickTarget(act);
        actors.current.set(a.id, act);
      } else {
        // Zones rebuild every poll; only re-target when the rect VALUE changed,
        // else a stale target may sit outside the new home and pin the sprite to a wall.
        const moved = act.home.x !== home.x || act.home.y !== home.y || act.home.w !== home.w || act.home.h !== home.h;
        act.status = a.status; act.home = home; act.charIndex = charIndexFor(a.role); act.paneId = a.paneId;
        if (!act.pinned) {
          act.x = clamp(act.x, home.x, home.x + Math.max(0, home.w - SPRITE));
          act.y = clamp(act.y, home.y, home.y + Math.max(0, home.h - SPRITE));
          if (moved) pickTarget(act);
        }
      }
    }
    for (const id of [...actors.current.keys()]) if (!live.has(id)) { actors.current.delete(id); els.current.delete(id); }
  }, [stage, state]);

  // Keep the animated-prop frame counters in sync with the current placements.
  useEffect(() => {
    animsRef.current = props.anims;
    const live = new Set(props.anims.map((a) => a.id));
    for (const id of [...animState.current.keys()]) if (!live.has(id)) { animState.current.delete(id); propEls.current.delete(id); }
    for (const a of props.anims) if (!animState.current.has(a.id)) animState.current.set(a.id, { frame: 0, t: 0 });
  }, [props]);

  // Single rAF drives every sprite (wander + walk-cycle) AND the ambient prop
  // frame cycling, mutating the DOM directly.
  useEffect(() => {
    reduceRef.current = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0; let last = 0;
    const tick = (t: number) => {
      const dt = last ? Math.min(60, t - last) : 16; last = t;
      const nowMs = Date.now();
      // De-overlap STANDING sprites: a team dissolve / re-align can stack idle
      // agents on one spot (only workers wander apart). Gently push same-zone
      // neighbours apart until they're spaced out — no manual dragging. Workers
      // re-place themselves below; dragged sprites are left alone.
      const SEP = SPRITE * 0.85;
      const standing = [...actors.current.values()].filter((a) => a.status !== 'working' && !a.pinned);
      for (let i = 0; i < standing.length; i++) {
        const a = standing[i];
        const maxX = a.home.x + Math.max(0, a.home.w - SPRITE), maxY = a.home.y + Math.max(0, a.home.h - SPRITE);
        for (let j = i + 1; j < standing.length; j++) {
          const b = standing[j];
          if (a.home !== b.home) continue; // same zone only (shared rect ref per cluster)
          let dx = a.x - b.x, dy = a.y - b.y, dist = Math.hypot(dx, dy);
          if (dist >= SEP) continue;
          if (dist < 0.01) { dx = (i % 2 ? 1 : -1); dy = (j % 2 ? 1 : -1); dist = Math.hypot(dx, dy); } // exactly stacked → deterministic split
          const k = ((SEP - dist) / dist) * 0.18 * (dt / 16); // ≤ ~2.5px/frame → converges fast, no teleport
          const mx = dx * k, my = dy * k;
          a.x = clamp(a.x + mx, a.home.x, maxX); a.y = clamp(a.y + my, a.home.y, maxY);
          b.x = clamp(b.x - mx, b.home.x, maxX); b.y = clamp(b.y - my, b.home.y, maxY);
        }
      }
      for (const act of actors.current.values()) {
        const el = els.current.get(act.id);
        if (!el) continue;
        if (act.status === 'working' && !act.pinned) {
          if (act.waitT > 0) { act.waitT -= dt; act.frame = 0; }
          else {
            const dx = act.tx - act.x, dy = act.ty - act.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 2) pickTarget(act);
            else {
              const sp = 0.035 * dt;
              const nx = act.x + (dx / dist) * sp;
              const ny = act.y + (dy / dist) * sp;
              const maxX = act.home.x + Math.max(0, act.home.w - SPRITE);
              const maxY = act.home.y + Math.max(0, act.home.h - SPRITE);
              const cx = clamp(nx, act.home.x, maxX);
              const cy = clamp(ny, act.home.y, maxY);
              act.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : (dy < 0 ? 3 : 0);
              act.frameT += dt;
              if (act.frameT > 150) { act.frameT = 0; act.frame = (act.frame + 1) % 3; }
              act.x = cx; act.y = cy;
              if (cx !== nx || cy !== ny) pickTarget(act); // hit a wall → turn around
            }
          }
          el.style.backgroundPosition = bgPos(act.charIndex, act.dir, act.frame);
        } else {
          el.style.backgroundPosition = bgPos(act.charIndex, 0, 0);
        }
        el.style.transform = `translate(${act.x}px, ${act.y}px)`;
        // Stall aura: a depended-on agent (an arrowHEAD target) that's stopped
        // working for >1min pulses, so a stalled dependency stands out. The waiting
        // source (tail) is excluded — it's meant to be idle.
        if (act.status === 'working') act.idleSince = undefined;
        else if (act.idleSince == null) act.idleSince = nowMs;
        const stalled = act.idleSince != null && nowMs - act.idleSince > IDLE_AURA_MS
          && act.paneId != null && linkTargetPanesRef.current.has(act.paneId);
        el.classList.toggle('town-actor-aura', stalled);
        // A link SOURCE (waiter) shouldn't blink — calm its glow/bubble pulse.
        el.classList.toggle('town-actor-calm', act.paneId != null && linkSourcePanesRef.current.has(act.paneId));
      }
      // Dependency arrows: anchor each line + note pill to the two live sprite
      // centres; the arrow head stops at B's edge so it isn't hidden by the sprite.
      // Resolve a link endpoint to its live sprite by the STABLE pane id; if no
      // agent currently holds that pane the endpoint is gone → hide (don't fall
      // back to the positional id, or a reused id would retarget the arrow).
      const resolve = (id: string, pane: string) => {
        const ag = pane
          ? agentsRef.current.find((a) => a.paneId === pane)
          : agentsRef.current.find((a) => a.id === id);
        return ag ? actors.current.get(ag.id) : undefined;
      };
      for (const lk of linksRef.current) {
        const line = linkLineEls.current.get(lk.id);
        const label = linkLabelEls.current.get(lk.id);
        const fa = resolve(lk.from, lk.fromPane), fb = resolve(lk.to, lk.toPane);
        if (!fa || !fb) { if (line) line.style.display = 'none'; if (label) label.style.display = 'none'; continue; }
        const x1 = fa.x + SPRITE / 2, y1 = fa.y + SPRITE / 2;
        const cx = fb.x + SPRITE / 2, cy = fb.y + SPRITE / 2;
        const dx = cx - x1, dy = cy - y1, len = Math.hypot(dx, dy) || 1;
        const back = Math.min(len - 1, SPRITE * 0.55);
        const x2 = cx - (dx / len) * back, y2 = cy - (dy / len) * back;
        if (line) {
          line.style.display = '';
          line.setAttribute('x1', String(x1)); line.setAttribute('y1', String(y1));
          line.setAttribute('x2', String(x2)); line.setAttribute('y2', String(y2));
        }
        if (label) { label.style.display = ''; label.style.transform = `translate(${(x1 + x2) / 2}px, ${(y1 + y2) / 2}px)`; }
      }
      // Advance the animated decorations (frozen when reduced-motion is set).
      for (const a of animsRef.current) {
        const el = propEls.current.get(a.id);
        const st = animState.current.get(a.id);
        if (!el || !st) continue;
        if (!reduceRef.current) {
          st.t += dt;
          const period = 1000 / a.spec.fps;
          if (st.t >= period) { st.t -= period; st.frame = (st.frame + 1) % a.spec.frames.length; }
        }
        const k = a.spec.size / a.spec.fw;
        const [fx, fy] = a.spec.frames[st.frame];
        el.style.backgroundPosition = `${-fx * k}px ${-fy * k}px`;
      }
      // Staging-env lock item follows its holder; parks bottom-left if the holder
      // pane isn't on the map (dead / non-fleet). Hidden entirely when free/disabled.
      const lk = lockEl.current;
      if (lk) {
        if (lockRef.current.active) {
          const h = lockRef.current.holderId ? actors.current.get(lockRef.current.holderId) : null;
          lk.style.display = 'flex';
          if (h) lk.style.transform = `translate(${h.x + SPRITE - 10}px, ${h.y - 18}px)`;
          else lk.style.transform = `translate(8px, ${Math.max(0, (stageRef.current?.clientHeight || 400) - 40)}px)`;
        } else lk.style.display = 'none';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const centers = (id: string) => {
    const p = stage.placements[id];
    return p ? { x: p.home.x + p.home.w / 2, y: p.home.y + p.home.h / 2 } : null;
  };

  // Link editor (note on the arrow): create on drop, or edit/delete an existing one.
  const submitLink = async () => {
    const p = pending; if (!p) return;
    setPending(null);
    try { await saveLink(p.from, p.to, p.note, p.fromPane, p.toPane); reloadLinks?.(); } catch { /* keep the map quiet */ }
  };
  const removeLinkNow = async () => {
    const p = pending; if (!p?.editingId) return;
    setPending(null);
    try { await deleteLink(p.editingId); reloadLinks?.(); } catch { /* keep the map quiet */ }
  };
  const editLink = (l: AgentLink) =>
    setPending({
      from: l.from, to: l.to, fromPane: l.fromPane, toPane: l.toPane,
      fromLabel: nameOfPane(l.fromPane, nameOf(l.from)), toLabel: nameOfPane(l.toPane, nameOf(l.to)),
      note: l.note, editingId: l.id,
    });

  // Per-agent note: click the nametag → edit what the agent is doing (blank = delete).
  const openNote = (a: FleetAgent) =>
    setNotePending({ pane: a.paneId, label: labelFor(a), note: notes[a.paneId] || '' });
  const saveNoteNow = async (text: string) => {
    const p = notePending; if (!p) return;
    setNotePending(null);
    try { await saveNote(p.pane, text); reloadNotes?.(); } catch { /* keep the map quiet */ }
  };
  const removeNoteNow = async () => {
    const p = notePending; if (!p) return;
    setNotePending(null);
    try { await deleteNote(p.pane); reloadNotes?.(); } catch { /* keep the map quiet */ }
  };

  return (
    <div ref={wrapRef} className="w-full">
    <div ref={stageRef} className="town-stage" style={{ width: stage.width, height: stage.height }}>
      {/* Ambient scenery — pure decoration on the grass, behind every agent. */}
      {props.decos.map((d) => (
        <div key={d.id} className={`town-deco${d.id === 'landmark' && stagingOutOfSync ? ' town-deco-alarm' : ''}${d.id === 'landmark' && deploying ? ' town-deco-shake' : ''}`}
          title={d.id === 'landmark' && deploying ? 'deploying…' : d.id === 'landmark' && stagingOutOfSync ? 'staging is OUT OF SYNC — see the sync HUD' : undefined}
          style={{
          width: d.spec.w, height: d.spec.h,
          backgroundImage: `url(${d.spec.url})`, backgroundSize: `${d.spec.w}px ${d.spec.h}px`,
          transform: `translate(${d.x}px, ${d.y}px)`,
        }} />
      ))}
      {props.anims.map((a) => {
        const k = a.spec.size / a.spec.fw;
        return (
          <div key={a.id} className="town-anim"
            ref={(el) => { if (el) propEls.current.set(a.id, el); else propEls.current.delete(a.id); }}
            style={{
              width: a.spec.size, height: a.spec.size,
              backgroundImage: `url(${a.spec.url})`,
              backgroundSize: `${a.spec.sheetW * k}px ${a.spec.sheetH * k}px`,
              transform: `translate(${a.x}px, ${a.y}px)`,
            }} />
        );
      })}

      <svg className="absolute inset-0 pointer-events-none" width={stage.width} height={stage.height}>
        {state.roads.map((r) => {
          // skip roads inside one cluster (lead + workers already sit together)
          if (stage.placements[r.from]?.home === stage.placements[r.to]?.home) return null;
          const a = centers(r.from), b = centers(r.to);
          if (!a || !b) return null;
          return <line key={`${r.from}>${r.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#c084fc" strokeOpacity={0.5} strokeWidth={2} className="town-road" />;
        })}
      </svg>

      <AgentLinks
        links={links}
        registerLine={(id, el) => { if (el) linkLineEls.current.set(id, el); else linkLineEls.current.delete(id); }}
        registerLabel={(id, el) => { if (el) linkLabelEls.current.set(id, el); else linkLabelEls.current.delete(id); }}
        onEdit={editLink}
        pending={pending}
        onNote={(note) => setPending((p) => (p ? { ...p, note } : p))}
        onSubmit={submitLink}
        onCancel={() => setPending(null)}
        onDelete={removeLinkNow}
      />

      {stage.headers.map((h) => (
        <div key={h.session} className="town-district-label" style={{ left: 8, top: h.y }}>
          🏙 {h.session} <span className="town-dcount">🟢{h.counts.working} 🟡{h.counts.idle} ⚪{h.counts.offline}</span>
        </div>
      ))}

      {stage.zones.map((z) => {
        const tex = textureById(zoneTex[z.id] || 'default');
        return (
          <div key={z.id} className={`town-zone town-zone-${z.kind}`} style={{
            left: z.x, top: z.y, width: z.w, height: z.h,
            ...(tex?.url ? { backgroundImage: `url(${tex.url})`, backgroundSize: `${tex.size}px`, backgroundRepeat: 'repeat', imageRendering: 'pixelated' as const } : {}),
          }}>
            <span className="town-zone-label">
              {z.kind === 'campaign' ? '🎩' : z.kind === 'team' ? '🏠' : '·'} {z.label}
              {z.kind === 'team' && !z.known ? ' ~' : ''}
            </span>
            <button className="town-zone-paint" title="change floor texture"
              onClick={(e) => { e.stopPropagation(); setPicking({ id: z.id, label: z.label }); }}>🎨</button>
          </div>
        );
      })}

      {state.agents.map((a) => {
        const p = stage.placements[a.id];
        if (!p) return null;
        const cos = costumeFor(a.role);
        const hue = agentHue(a); // per-agent colour override (null = role default)
        return (
          <div
            key={a.id}
            ref={(el) => { if (el) els.current.set(a.id, el); else els.current.delete(a.id); }}
            className={`town-actor town-actor-${a.status}${a.waiting ? ' town-actor-wait' : ''}`}
            onPointerDown={(e) => onDown(e, a)}
            onPointerMove={onMove}
            onPointerUp={(e) => onUp(e, a)}
            style={{
              width: SPRITE, height: SPRITE,
              cursor: 'grab', touchAction: 'none',
              backgroundImage: `url(${SHEET_URL})`,
              backgroundSize: `${SHEET_W}px ${SHEET_H}px`,
              backgroundPosition: bgPos(charIndexFor(a.role), 0, 0),
              filter: hue != null ? `hue-rotate(${hue}deg)` : undefined,
              transform: `translate(${p.home.x}px, ${p.home.y}px)`,
            }}
            title={`${a.windowName}\n${a.task || '—'}\n(drag to move · click to open session)`}
          >
            {/* Each on its OWN row so a long 🔑account never hides ctx% (the bug was
                pinned agents only). Tag is bottom-anchored above the sprite, grows up. */}
            <span className="town-nametag town-nametag-click" style={{ borderColor: cos.color }}
              title="click to add / edit a note"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); openNote(a); }}>
              {a.isOrchestrator && <span className="town-nametag-crown">👑</span>}
              <span className="town-nametag-row1">
                <b style={{ color: cos.color }}>{cos.title}</b>
                {a.label && a.label !== 'oracle' ? <span className="town-nametag-slug">·{a.label}</span> : null}
              </span>
              {a.ctxPct != null ? <span className="town-nametag-ctx" style={{ color: ctxColor(a.ctxPct) }}>{a.ctxPct}%</span> : null}
              {a.plan ? <span className="town-nametag-acct" title={`Claude account: ${a.plan}`}>🔑{a.plan}</span> : null}
              {notes[a.paneId] ? <span className="town-nametag-note">📝 {notes[a.paneId]}</span> : null}
            </span>
            {a.waiting ? (
              <span className="town-bubble town-bubble-wait" title="waiting for your input — click to answer the menu">🔔</span>
            ) : a.status === 'working' ? (
              <span className="town-bubble town-bubble-work" title={a.task || ''}>{activityEmoji(a.task)}</span>
            ) : a.status === 'idle' ? (
              <span className="town-bubble town-bubble-idle">💤</span>
            ) : null}
          </div>
        );
      })}

      {/* Staging-env lock item — a Cainos chest that follows the holding agent;
          click → lock panel. The rAF toggles display + transform on this element. */}
      <div ref={lockEl} className="town-lock-item" title="staging env — locked (click to manage / release)"
        onClick={(e) => { e.stopPropagation(); onLockClick?.(); }}
        style={{ display: 'none', position: 'absolute', left: 0, top: 0, zIndex: 4, cursor: 'pointer', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: 36, height: 30, backgroundImage: 'url(/assets/town/lock-chest.png)', backgroundSize: 'contain', backgroundRepeat: 'no-repeat', imageRendering: 'pixelated' as const, filter: 'drop-shadow(0 1px 2px #000a)' }} />
        <span style={{ fontSize: 9, lineHeight: '11px', color: '#e9d5ff', background: '#1a1326dd', padding: '0 3px', borderRadius: 4, marginTop: -3, whiteSpace: 'nowrap' }}>staging</span>
      </div>
    </div>
    {picking && (
      <TexturePicker
        zoneLabel={picking.label}
        current={zoneTex[picking.id] || 'default'}
        onPick={(id) => {
          const m = { ...zoneTex };
          if (id === 'default') delete m[picking.id]; else m[picking.id] = id;
          setZoneTex(m); saveZoneTextures(m);
        }}
        onClose={() => setPicking(null)}
      />
    )}
    {notePending && (
      <AgentNoteEditor pending={notePending} onSave={saveNoteNow} onRemove={removeNoteNow} onCancel={() => setNotePending(null)} />
    )}
    </div>
  );
}
