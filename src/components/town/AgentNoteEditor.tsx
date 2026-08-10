// Small editor for a per-agent note. Opens when you click an agent's nametag.
// Type what they're doing → Save; Remove deletes it. Mobile-friendly centered modal.
import { useState } from 'react';

export interface NotePending { pane: string; label: string; note: string }

export function AgentNoteEditor(props: {
  pending: NotePending;
  onSave: (note: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(props.pending.note);
  const has = !!props.pending.note.trim();
  return (
    <div className="town-link-editor-backdrop" onPointerDown={props.onCancel}>
      <div className="town-link-editor" onPointerDown={(e) => e.stopPropagation()}>
        <div className="town-link-editor-head">
          📝 note for <b style={{ color: '#fcd34d' }}>{props.pending.label}</b>
        </div>
        <input autoFocus className="town-link-editor-input" placeholder="what are they doing? (e.g. waiting on review)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') props.onSave(text); if (e.key === 'Escape') props.onCancel(); }} />
        <div className="town-link-editor-actions">
          {has && <button className="town-link-btn town-link-btn-del" onClick={props.onRemove}>🗑 remove</button>}
          <span style={{ flex: 1 }} />
          <button className="town-link-btn" onClick={props.onCancel}>cancel</button>
          <button className="town-link-btn town-link-btn-save" onClick={() => props.onSave(text)}>save</button>
        </div>
      </div>
    </div>
  );
}
