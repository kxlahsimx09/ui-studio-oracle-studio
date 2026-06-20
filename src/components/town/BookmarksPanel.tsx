// Bookmarked agents — saved resume recipes. Respawn brings an agent back on its
// SAME worktree + account with its context (`maw wake --wt`, no --fresh). Lets you
// close a session now and reopen it later. (Town-spawned/maw-wake agents only.)
import { useEffect, useState } from 'react';
import { listBookmarks, removeBookmark, respawnBookmark, type Bookmark } from '../../lib/fleet';
import { costumeFor } from '../../lib/role-costume';

export function BookmarksPanel({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<Bookmark[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = () => listBookmarks().then(setList).catch(() => {});
  useEffect(() => { reload(); }, []);

  const respawn = async (b: Bookmark) => {
    setBusy(b.id); setMsg(null);
    try { await respawnBookmark(b.id); setMsg(`▶ respawning ${b.role} · ${b.worktree} — it will reappear on the map shortly.`); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(null); }
  };
  const del = async (b: Bookmark) => {
    setBusy(b.id);
    try { await removeBookmark(b.id); setList((l) => l.filter((x) => x.id !== b.id)); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(null); }
  };

  return (
    <div className="fixed inset-0 z-[56] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-[min(560px,96vw)] max-h-[90vh] overflow-auto rounded-xl border border-white/15 bg-[#0c0c12] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-[14px] text-white/90">🔖 Bookmarked agents</span>
          <button onClick={onClose} className="text-white/50 hover:text-white/90 text-sm">✕</button>
        </div>
        <p className="text-[11px] text-white/40 mb-3">Respawn brings an agent back on its <b>same worktree + account</b> with its context (resume, not fresh). Bookmark an agent from its chat window (🔖) before closing it.</p>

        {list.length === 0 && <p className="text-[12px] text-white/40 py-6 text-center">No bookmarks yet. Open an agent → 🔖 to save its resume recipe.</p>}

        <div className="flex flex-col gap-2">
          {list.map((b) => {
            const cos = costumeFor(b.role.replace(/-\d+$/, ''));
            return (
              <div key={b.id} className="rounded-lg border border-white/10 p-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[15px]" title={b.role}>{cos?.emoji || '🤖'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] text-white/90 truncate">{b.role} <span className="text-white/40 font-mono">·{b.worktree}</span></div>
                    <div className="text-[10px] text-white/40 truncate">
                      {b.planName ? <span title="Claude account">🔑{b.planName} · </span> : null}
                      {b.note || b.windowName || ''}
                    </div>
                  </div>
                  <button disabled={!!busy} onClick={() => respawn(b)} title="resume this agent on its worktree + account"
                    className="shrink-0 px-2 py-1 rounded text-[11px] disabled:opacity-40" style={{ background: '#4ade8022', color: '#4ade80', border: '1px solid #4ade8055' }}>
                    {busy === b.id ? '…' : '▶ respawn'}
                  </button>
                  <button disabled={!!busy} onClick={() => del(b)} title="remove bookmark"
                    className="shrink-0 px-1.5 py-1 rounded text-[11px] text-white/40 hover:text-red-300">✕</button>
                </div>
              </div>
            );
          })}
        </div>
        {msg && <p className="text-[11px] text-amber-300 mt-2">{msg}</p>}
      </div>
    </div>
  );
}
