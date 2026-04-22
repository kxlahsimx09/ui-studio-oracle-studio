import { useNavigate } from 'react-router-dom';
import type { ClaudeSession } from '../../api/maw';

const DESKS_PER_ROW = 4;
const DESK_ROWS = 1;
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

function Character({ s, size = 'lg' }: { s: ClaudeSession; size?: 'lg' | 'md' }) {
  const emoji = s.status === 'active' ? '🧑‍💻' : s.status === 'idle' ? '😴' : '👤';
  const px = size === 'lg' ? 56 : 48;
  return (
    <div
      className={`relative flex items-center justify-center rounded-full shadow-xl ring-2 ring-zinc-900 ${
        s.status === 'active' ? 'animate-[bounce_2.4s_ease-in-out_infinite]' : ''
      }`}
      style={{
        width: px,
        height: px,
        backgroundColor: charColor(s),
        fontSize: size === 'lg' ? 30 : 26,
      }}
    >
      <span>{emoji}</span>
      <span
        className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-zinc-900 ${
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
      title={session ? tooltipText(session) : 'Open desk — anyone can sit here'}
      className={`group relative flex aspect-[5/4] flex-col items-center justify-end rounded-md border transition-all ${
        empty
          ? 'cursor-default border-dashed border-zinc-800/60 bg-zinc-900/20'
          : 'cursor-pointer border-zinc-700 bg-gradient-to-b from-amber-950/20 to-amber-900/30 hover:border-amber-600/60 hover:shadow-xl'
      }`}
    >
      {/* Monitor on the desk */}
      <div className="absolute left-1/2 top-2 h-7 w-12 -translate-x-1/2 rounded border border-zinc-700 bg-zinc-950/80">
        <div
          className={`m-0.5 h-[calc(100%-4px)] w-[calc(100%-4px)] rounded-sm ${
            session?.status === 'active' ? 'bg-emerald-900/70' : 'bg-zinc-900'
          }`}
        />
        <div className="absolute left-1/2 top-full h-1.5 w-2 -translate-x-1/2 bg-zinc-700" />
      </div>

      {/* Character seat */}
      <div className="relative mb-2 mt-12 flex items-center justify-center">
        {session ? (
          <Character s={session} size="lg" />
        ) : (
          <span className="text-3xl opacity-15">🪑</span>
        )}
      </div>

      {/* Name label (hover) */}
      {session && (
        <div className="pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-950/95 px-2 py-0.5 text-[10px] font-mono text-zinc-300 opacity-0 shadow-lg ring-1 ring-zinc-800 transition-opacity group-hover:opacity-100">
          {initials(session)} · {session.worktree?.name || 'main'}
        </div>
      )}
    </button>
  );
}

function BreakCharacter({ s, onClick }: { s: ClaudeSession; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={tooltipText(s)}
      className="group flex flex-col items-center transition-transform hover:-translate-y-1"
    >
      <Character s={s} size="md" />
      <span className="mt-1 font-mono text-[10px] text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100">
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

  // Shared-desk model: only actively working agents occupy a desk.
  // Everyone not currently working hangs out in the break room (idle + ended).
  // Sort active by most-recent so the newest worker fills the first desk.
  const activeSorted = sessions
    .filter(s => s.status === 'active')
    .sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1));
  const atDesk = activeSorted.slice(0, MAX_DESKS);
  const deskOverflow = activeSorted.slice(MAX_DESKS);

  const inBreak = sessions
    .filter(s => s.status === 'idle' || s.status === 'ended')
    .sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1));
  const breakPeople = [...deskOverflow, ...inBreak];

  return (
    <div className="relative flex-1 overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-900 p-6">
      <div
        className="relative mx-auto flex h-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 shadow-2xl"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      >
        {/* Top strip — heading + door */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">The Office</h1>
            <p className="text-[11px] text-zinc-500">
              {atDesk.length} working · {breakPeople.length} on break · {sessions.length} total
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Decor emoji="🪴" />
            <Decor emoji="🚪" label="entrance" />
          </div>
        </div>

        {/* Work area — shared desk pool (single row, 4 shared desks) */}
        <div className="mb-4 shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">
          Desks · shared ({atDesk.length}/{MAX_DESKS})
        </div>
        <div
          className="grid shrink-0 gap-x-5 gap-y-10 pb-6"
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

        {/* Break room — fills remaining space, characters scroll if crowded */}
        <div className="mt-4 flex min-h-0 flex-1 flex-col border-t border-dashed border-zinc-800 pt-5">
          <div className="mb-3 flex shrink-0 items-baseline justify-between">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Break room</div>
            {breakPeople.length > 0 && (
              <div className="font-mono text-[10px] text-zinc-600">{breakPeople.length} hanging out</div>
            )}
          </div>
          <div className="flex min-h-0 flex-1 items-start gap-6">
            <div className="flex shrink-0 items-end gap-3">
              <Decor emoji="🛋️" label="couch" size="text-4xl" />
              <Decor emoji="☕" label="coffee" size="text-2xl" />
              <Decor emoji="🪴" size="text-2xl" />
            </div>
            <div className="flex flex-1 flex-wrap content-start items-start gap-x-5 gap-y-4 overflow-y-auto pl-2 pt-1 pr-1">
              {breakPeople.length === 0 ? (
                <span className="self-center text-[11px] italic text-zinc-600">empty</span>
              ) : (
                breakPeople.map(s => (
                  <BreakCharacter
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
