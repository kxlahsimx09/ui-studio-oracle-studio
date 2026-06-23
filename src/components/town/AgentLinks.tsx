// "Who waits for whom" arrows on the town map. PixelTown owns the live sprite
// positions (mutated each rAF frame); this component only renders the DOM nodes
// and hands their refs back up via registerLine/registerLabel so the rAF can move
// the arrow endpoints + note pill to follow the two sprites. Also renders the
// note editor that pops up when you drag one agent onto another.
import type { AgentLink } from '../../lib/agent-links';

export interface PendingLink {
  from: string; to: string;
  fromPane: string; toPane: string; // stable tmux pane ids — the real identity
  fromLabel: string; toLabel: string;
  note: string;
  editingId?: string; // set when editing an existing link (Save replaces, Delete removes)
}

export function AgentLinks(props: {
  links: AgentLink[];
  registerLine: (id: string, el: SVGLineElement | null) => void;
  registerLabel: (id: string, el: HTMLDivElement | null) => void;
  onEdit: (link: AgentLink) => void;
  pending: PendingLink | null;
  onNote: (note: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { links, registerLine, registerLabel, onEdit, pending } = props;
  return (
    <>
      {/* Arrow lines live in their own SVG overlay; endpoints set per-frame by rAF. */}
      <svg className="town-links-svg" width="100%" height="100%">
        <defs>
          <marker id="town-link-arrow" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#fbbf24" />
          </marker>
        </defs>
        {links.map((l) => (
          <line key={l.id} ref={(el) => registerLine(l.id, el)}
            className="town-link-line" markerEnd="url(#town-link-arrow)"
            stroke="#fbbf24" strokeOpacity={0.85} strokeWidth={2.5} strokeDasharray="6 4" />
        ))}
      </svg>

      {/* Note pills — clickable to edit/delete; positioned at the line midpoint by rAF. */}
      {links.map((l) => (
        <div key={l.id} ref={(el) => registerLabel(l.id, el)}
          className="town-link-note" title="click to edit / delete this dependency"
          onPointerDown={(e) => { e.stopPropagation(); onEdit(l); }}>
          {l.note || 'waiting'}
        </div>
      ))}

      {pending && (
        <div className="town-link-editor-backdrop" onPointerDown={props.onCancel}>
          <div className="town-link-editor" onPointerDown={(e) => e.stopPropagation()}>
            <div className="town-link-editor-head">
              <b style={{ color: '#fcd34d' }}>{pending.fromLabel}</b>
              <span className="town-link-editor-arrow"> ⟶ waiting on ⟶ </span>
              <b style={{ color: '#fcd34d' }}>{pending.toLabel}</b>
            </div>
            <input autoFocus className="town-link-editor-input" placeholder="note on the arrow (e.g. blocked on schema)"
              value={pending.note}
              onChange={(e) => props.onNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') props.onSubmit(); if (e.key === 'Escape') props.onCancel(); }} />
            <div className="town-link-editor-actions">
              {pending.editingId && (
                <button className="town-link-btn town-link-btn-del" onClick={props.onDelete}>🗑 remove</button>
              )}
              <span style={{ flex: 1 }} />
              <button className="town-link-btn" onClick={props.onCancel}>cancel</button>
              <button className="town-link-btn town-link-btn-save" onClick={props.onSubmit}>
                {pending.editingId ? 'save' : 'link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
