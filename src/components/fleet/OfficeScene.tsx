import { useNavigate } from 'react-router-dom';
import type { ClaudeSession } from '../../api/maw';

const DESKS_PER_ROW = 4;
const DESK_ROWS = 3;
const MAX_DESKS = DESKS_PER_ROW * DESK_ROWS;

function initials(s: ClaudeSession): string {
  const src = s.worktree?.name || s.repo?.split('/').pop() || s.sessionId;
  return src.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'AG';
}

function charColor(s: ClaudeSession): string {
  // Deterministic hue from sessionId so same agent always has same color
  let h = 0;
  for (let i = 0; i < s.sessionId.length; i++) h = (h * 31 + s.sessionId.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 60% 55%)`;
}

function tooltipText(s: ClaudeSession): string {
  const repo = s.repo?.split('/').slice(-2).join('/') || '(unknown)';
  const wt = s.worktree ? ` · wt/${s.worktree.name}` : '';
  const msg = s.lastAssistantMessage || s.lastUserMessage || '';
  return `${repo}${wt}\n${s.status} · ${msg.slice(0, 80)}`;
}

function Character({ s, working }: { s: ClaudeSession; working: boolean }) {
  const emoji = s.status === 'active' ? '🧑‍💻' : s.status === 'idle' ? '😴' : '🪑';
  return (
    <div
      className={`relative flex items-center justify-center rounded-full text-lg shadow-lg ring-2 ring-zinc-900 ${
        s.status === 'active' ? 'animate-[bounce_2s_ease-in-out_infinite]' : ''
      }`}
      style={{
        width: working ? 34 : 28,
        height: working ? 34 : 28,
        backgroundColor: charColor(s),
      }}
    >
      <span>{emoji}</span>
      <span
        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-1 ring-zinc-900 ${
          s.status === 'active'
            ? 'bg-emerald-400 animate-pulse'
            : s.status === 'idle'
              ? 'bg-amber-400'
              : 'bg-zinc-600'
        }`}
      />
    </div>
  );
}

function Desk({ session, onClick }: { session: ClaudeSession | undefined; onClick: () => void }) {
  const empty = !session;
  return (
    <button
      onClick={onClick}
      disabled={empty}
      title={session ? tooltipText(session) : 'Empty desk'}
      className={`group relative flex aspect-[4/3] flex-col items-center justify-end rounded-md border transition-all ${
        empty
          ? 'cursor-default border-zinc-800/50 bg-zinc-900/30'
          : 'cursor-pointer border-zinc-700 bg-gradient-to-b from-amber-950/20 to-amber-900/30 hover:border-amber-600/50 hover:shadow-lg'
      }`}
    >
      {/* Monitor on the desk */}
      <div className="absolute left-1/2 top-1 h-4 w-6 -translate-x-1/2 rounded-sm border border-zinc-700 bg-zinc-950/80 sm:h-5 sm:w-8">
        <div className={`h-full w-full rounded-sm ${session?.status === 'active' ? 'bg-emerald-900/60' : 'bg-zinc-900'}`} />
      </div>

      {/* Chair + character */}
      <div className="relative mb-1 flex items-center justify-center">
        {session ? (
          <Character s={session} working />
        ) : (
          <span className="text-xl opacity-20">🪑</span>
        )}
      </div>

      {/* Label */}
      {session && (
        <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 rounded bg-zinc-950/90 px-1.5 py-0.5 text-[9px] font-mono text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100 shadow">
          {initials(session)}
        </div>
      )}
    </button>
  );
}

function LoungeCharacter({ s, onClick }: { s: ClaudeSession; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={tooltipText(s)}
      className="group flex flex-col items-center transition-transform hover:-translate-y-0.5"
    >
      <Character s={s} working={false} />
      <span className="mt-1 font-mono text-[9px] text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100">
        {initials(s)}
      </span>
    </button>
  );
}

function Decor({ emoji, label, size = 'text-2xl' }: { emoji: string; label?: string; size?: string }) {
  return (
    <div className="flex flex-col items-center opacity-80" title={label}>
      <span className={size}>{emoji}</span>
      {label && <span className="mt-0.5 text-[9px] text-zinc-600">{label}</span>}
    </div>
  );
}

interface Props {
  sessions: ClaudeSession[];
}

export function OfficeScene({ sessions }: Props) {
  const navigate = useNavigate();
  const live = sessions.filter(s => s.status !== 'ended');
  const ordered = [...live].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return a.lastActivityAt < b.lastActivityAt ? 1 : -1;
  });
  const atDesk = ordered.slice(0, MAX_DESKS);
  const atLounge = ordered.slice(MAX_DESKS);

  return (
    <div className="relative flex-1 overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-900 p-6">
      <div
        className="relative mx-auto flex h-full max-w-5xl flex-col rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 shadow-2xl"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      >
        {/* Top strip — door + plants + heading */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">The Office</h1>
            <p className="text-[11px] text-zinc-500">
              {atDesk.length} at work · {atLounge.length} on break · {sessions.filter(s => s.status === 'ended').length} gone home
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Decor emoji="🪴" />
            <Decor emoji="🚪" label="entrance" />
          </div>
        </div>

        {/* Work area — desk grid */}
        <div
          className="grid gap-x-4 gap-y-8 pb-2"
          style={{ gridTemplateColumns: `repeat(${DESKS_PER_ROW}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: MAX_DESKS }).map((_, i) => (
            <Desk
              key={i}
              session={atDesk[i]}
              onClick={() => atDesk[i] && navigate(`/fleet/${atDesk[i].sessionId}`)}
            />
          ))}
        </div>

        {/* Lounge area */}
        <div className="mt-auto border-t border-dashed border-zinc-800 pt-4">
          <div className="mb-3 flex items-baseline justify-between">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Break room</div>
            {atLounge.length > 0 && (
              <div className="font-mono text-[10px] text-zinc-600">{atLounge.length} on couch</div>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <Decor emoji="🛋️" label="couch" size="text-3xl" />
            <Decor emoji="☕" label="coffee" />
            <Decor emoji="🪴" />
            <div className="flex flex-wrap gap-2 pl-2">
              {atLounge.length === 0 ? (
                <span className="self-center text-[10px] text-zinc-600 italic">empty</span>
              ) : (
                atLounge.map(s => (
                  <LoungeCharacter
                    key={s.sessionId}
                    s={s}
                    onClick={() => navigate(`/fleet/${s.sessionId}`)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
