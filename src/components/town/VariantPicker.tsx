// Pick a sprite variant (colour/body) for ONE agent on the town map. 32 folk
// variants (8 bodies × 4 hue palettes); the choice is per-agent (localStorage),
// not per-role. Picking applies immediately on the next map poll.
import { swatchStyle } from '../../lib/sprite';
import { VARIANT_COUNT } from '../../lib/agent-variants';

const S = 42; // swatch px

export function VariantPicker({ label, current, roleDefault, onPick, onClose }: {
  label: string; current: number; roleDefault: number;
  onPick: (idx: number | null) => void; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="rounded-xl border border-white/15 bg-[#0c0c12] p-4 max-h-[88vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[13px] font-semibold text-white/90">🎨 Variant — {label}</span>
          <button onClick={onClose} className="text-white/50 hover:text-white/90 text-sm">✕</button>
        </div>
        <p className="text-[11px] text-white/45 mb-2.5">Recolours <b>this agent only</b> on the map. Applies within a couple seconds.</p>

        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(8, ${S}px)` }}>
          {Array.from({ length: VARIANT_COUNT }, (_, i) => (
            <button key={i} onClick={() => onPick(i)} title={`variant ${i}${i === roleDefault ? ' (role default)' : ''}`}
              className="rounded"
              style={{
                width: S, height: S,
                ...swatchStyle(i, S),
                outline: i === current ? '2px solid #4ade80' : '1px solid rgba(255,255,255,0.12)',
                outlineOffset: '-1px',
              }} />
          ))}
        </div>

        <button onClick={() => onPick(null)} className="mt-3 w-full rounded-lg py-1.5 text-[11px]"
          style={{ background: '#ffffff10', color: '#bbb', border: '1px solid rgba(255,255,255,0.12)' }}>
          ↺ Reset to role default
        </button>
      </div>
    </div>
  );
}
