import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ClaudeSession, FleetJob } from '../../api/maw';
import { ROLES_BY_NAME, ROLES_BY_REPO, UNKNOWN_ROLE, type Role } from '../../config/fleet';

const CAT_GIF = '/assets/fleet/happy_cat.gif';
const CAT_STILL = '/assets/fleet/happy_cat_still.png';
const CAT_AUDIO = '/assets/fleet/happy_cat.mp3';
const MUTE_STORAGE_KEY = 'fleet.machine.mute';

const DESKS_PER_ROW = 4;
const DESK_ROWS = 1;
const MAX_DESKS = DESKS_PER_ROW * DESK_ROWS;

export function inferRole(s: ClaudeSession): Role {
  if (s.role && ROLES_BY_NAME[s.role]) return ROLES_BY_NAME[s.role];
  if (s.repo && ROLES_BY_REPO[s.repo]) return ROLES_BY_REPO[s.repo];
  return UNKNOWN_ROLE;
}

function initials(s: ClaudeSession): string {
  const src = s.worktree?.name || s.repo?.split('/').pop() || s.sessionId;
  return src.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'AG';
}

function tooltipText(s: ClaudeSession): string {
  const role = inferRole(s);
  const repo = s.repo?.split('/').slice(-2).join('/') || '(unknown)';
  const wt = s.worktree ? `\nwt/${s.worktree.name}` : '';
  const msg = s.lastAssistantMessage || s.lastUserMessage || '';
  return `${role.label} · ${repo}${wt}\n${s.status} · ${msg.slice(0, 80)}`;
}

function Character({ s, size = 'lg' }: { s: ClaudeSession; size?: 'lg' | 'md' }) {
  const role = inferRole(s);
  const px = size === 'lg' ? 88 : 68;
  const emojiSize = size === 'lg' ? 46 : 36;
  return (
    <div className="flex flex-col items-center">
      <div
        className={`relative flex items-center justify-center rounded-full shadow-xl ring-4 ring-zinc-900 ${role.color} ${
          s.status === 'active' ? 'animate-[bounce_2.4s_ease-in-out_infinite]' : ''
        }`}
        style={{ width: px, height: px, fontSize: emojiSize }}
      >
        <span>{role.emoji}</span>
        {/* Status dot */}
        <span
          className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full ring-2 ring-zinc-900 ${
            s.status === 'active'
              ? 'bg-emerald-400 animate-pulse'
              : s.status === 'idle'
                ? 'bg-amber-400'
                : 'bg-zinc-600'
          }`}
        />
        {/* Initials badge (worktree identity when 2+ agents share a role) */}
        <span className="absolute -top-1 -left-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-950 px-1 font-mono text-[9px] font-bold text-zinc-200 ring-2 ring-zinc-900">
          {initials(s)}
        </span>
      </div>
      {/* Always-visible role label */}
      <div
        className={`mt-1.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ring-1 ${role.ringColor} text-zinc-200 bg-zinc-950/80`}
      >
        {role.label}
      </div>
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
      className={`group relative flex min-h-[220px] flex-col items-center justify-end rounded-md border p-3 transition-all ${
        empty
          ? 'cursor-default border-dashed border-zinc-800/60 bg-zinc-900/20'
          : 'cursor-pointer border-zinc-700 bg-gradient-to-b from-amber-950/20 to-amber-900/30 hover:border-amber-600/60 hover:shadow-xl'
      }`}
    >
      {/* Monitor on the desk */}
      <div className="absolute left-1/2 top-3 h-10 w-16 -translate-x-1/2 rounded border border-zinc-700 bg-zinc-950/80 shadow">
        <div
          className={`m-1 h-[calc(100%-8px)] w-[calc(100%-8px)] rounded-sm ${
            session?.status === 'active' ? 'bg-emerald-900/70' : 'bg-zinc-900'
          }`}
        />
        <div className="absolute left-1/2 top-full h-2 w-3 -translate-x-1/2 bg-zinc-700" />
        <div className="absolute left-1/2 top-[calc(100%+8px)] h-0.5 w-8 -translate-x-1/2 bg-zinc-700" />
      </div>

      {/* Character seat */}
      <div className="relative mb-1 mt-16 flex items-center justify-center">
        {session ? (
          <Character s={session} size="lg" />
        ) : (
          <span className="text-5xl opacity-15">🪑</span>
        )}
      </div>
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

function formatRuntime(iso: string): string {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return `${h}h ${m}m`;
}

function useMutePreference(): [boolean, (m: boolean) => void] {
  const [muted, setMuted] = useState<boolean>(() => {
    try { return localStorage.getItem(MUTE_STORAGE_KEY) !== '0'; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
  }, [muted]);
  return [muted, setMuted];
}

/** Shared across all Machine instances on the page so one click controls all. */
function MachineAudio({ playing, muted }: { playing: boolean; muted: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.muted = muted;
    if (playing) {
      a.play().catch(() => { /* autoplay blocked — will play after first user gesture */ });
    } else {
      a.pause();
      a.currentTime = 0;
    }
  }, [playing, muted]);
  return <audio ref={audioRef} src={CAT_AUDIO} loop preload="none" />;
}

function Machine({ job, muted, onToggleMute }: { job: FleetJob | undefined; muted: boolean; onToggleMute: () => void }) {
  const running = !!job;
  const kind = job?.kind || 'regression';
  const tooltip = job
    ? `${kind} · pid ${job.pid} · ${formatRuntime(job.startedAt)}${job.singleTest ? `\n${job.singleTest}` : ''}${job.runId ? `\nrun ${job.runId}` : ''}`
    : 'regression — idle (cat naps)';
  return (
    <div className="flex flex-col items-center" title={tooltip}>
      <div
        className={`relative overflow-hidden rounded-lg border-2 bg-zinc-900 transition-all ${
          running
            ? 'border-emerald-500/70 shadow-[0_0_24px_rgba(16,185,129,0.4)]'
            : 'border-zinc-700'
        }`}
      >
        <img
          src={running ? CAT_GIF : CAT_STILL}
          alt={running ? 'running' : 'idle'}
          width={104}
          height={186}
          className={`block h-32 w-auto transition-all ${running ? '' : 'grayscale-[40%] opacity-80'}`}
          draggable={false}
        />
        <span
          className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full ring-2 ring-zinc-950 ${
            running ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'
          }`}
        />
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ring-1 ${
            running
              ? 'bg-emerald-950/60 text-emerald-200 ring-emerald-500/60'
              : 'bg-zinc-950/60 text-zinc-500 ring-zinc-700'
          }`}
        >
          {kind}
        </span>
        <button
          onClick={onToggleMute}
          title={muted ? 'unmute cat' : 'mute cat'}
          className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[11px] leading-none text-zinc-300 hover:bg-zinc-800 hover:border-zinc-600"
        >
          {muted ? '🔇' : '🔊'}
        </button>
      </div>
      {running && (
        <span className="mt-0.5 font-mono text-[9px] text-emerald-400/70">
          {formatRuntime(job!.startedAt)}
        </span>
      )}
    </div>
  );
}

interface Props {
  sessions: ClaudeSession[];
  jobs?: FleetJob[];
}

export function OfficeScene({ sessions, jobs = [] }: Props) {
  const navigate = useNavigate();
  const [muted, setMuted] = useMutePreference();

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
          <div className="flex items-end gap-5">
            {jobs.length > 0 ? (
              jobs.map(j => <Machine key={j.pid} job={j} muted={muted} onToggleMute={() => setMuted(!muted)} />)
            ) : (
              <Machine job={undefined} muted={muted} onToggleMute={() => setMuted(!muted)} />
            )}
            <MachineAudio playing={jobs.length > 0} muted={muted} />
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
