import { Link, useParams } from 'react-router-dom';
import type { ClaudeSession, ClaudeStatus } from '../../api/maw';

function ago(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

function statusDot(s: ClaudeStatus): string {
  if (s === 'active') return 'bg-emerald-500 animate-pulse';
  if (s === 'idle') return 'bg-amber-400';
  return 'bg-zinc-600';
}

function repoLabel(s: ClaudeSession): string {
  if (!s.repo) return s.projectDir.slice(-30);
  const parts = s.repo.split('/');
  return parts.slice(-2).join('/');
}

function AgentRow({ s, selected }: { s: ClaudeSession; selected: boolean }) {
  return (
    <Link
      to={`/fleet/${s.sessionId}`}
      className={`block rounded px-2 py-2 text-xs transition-colors ${
        selected
          ? 'bg-zinc-800 ring-1 ring-zinc-600'
          : 'hover:bg-zinc-900'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(s.status)}`} />
        <span className="truncate font-medium text-zinc-200">{repoLabel(s)}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-500">{ago(s.lastActivityAt)}</span>
      </div>
      {s.worktree && (
        <div className="mt-1 truncate font-mono text-[10px] text-zinc-500">
          wt/{s.worktree.name} · {s.worktree.branch}
        </div>
      )}
      {(s.lastUserMessage || s.lastAssistantMessage) && (
        <div className="mt-1 line-clamp-2 text-[11px] text-zinc-400">
          {s.lastAssistantMessage || s.lastUserMessage}
        </div>
      )}
    </Link>
  );
}

interface SectionProps {
  label: string;
  count: number;
  sessions: ClaudeSession[];
  selectedId?: string;
}

function Section({ label, count, sessions, selectedId }: SectionProps) {
  if (count === 0) return null;
  return (
    <div className="mb-4">
      <div className="mb-1 flex items-baseline gap-2 px-2">
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</h3>
        <span className="font-mono text-[10px] text-zinc-600">{count}</span>
      </div>
      <div className="space-y-1">
        {sessions.map(s => (
          <AgentRow key={s.sessionId} s={s} selected={s.sessionId === selectedId} />
        ))}
      </div>
    </div>
  );
}

interface Props {
  sessions: ClaudeSession[];
  generatedAt?: string | null;
  error?: string | null;
  loading?: boolean;
}

export function AgentSidebar({ sessions, generatedAt, error, loading }: Props) {
  const { id } = useParams<{ id: string }>();
  const active = sessions.filter(s => s.status === 'active');
  const idle = sessions.filter(s => s.status === 'idle');
  const ended = sessions.filter(s => s.status === 'ended');

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950/60">
      <div className="border-b border-zinc-800 px-3 py-3">
        <h2 className="text-sm font-semibold text-zinc-200">Roster</h2>
        <p className="mt-0.5 text-[10px] text-zinc-500">
          {sessions.length} session{sessions.length === 1 ? '' : 's'}
          {generatedAt && ` · every 2s`}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {loading && <div className="p-4 text-center text-xs text-zinc-500">loading…</div>}
        {error && (
          <div className="rounded border border-red-900/50 bg-red-950/30 p-2 text-[11px] text-red-300">
            <div>Fleet unavailable</div>
            <div className="mt-1 text-[10px] text-red-400/80">{error}</div>
            <div className="mt-1 text-[10px] text-zinc-500">maw-js :3456 running?</div>
          </div>
        )}
        {!loading && !error && sessions.length === 0 && (
          <div className="p-4 text-center text-[11px] text-zinc-500">
            No Claude Code sessions. Open one in any repo.
          </div>
        )}
        <Section label="At their desk" count={active.length} sessions={active} selectedId={id} />
        <Section label="Stepped away" count={idle.length} sessions={idle} selectedId={id} />
        <Section label="Gone home" count={ended.length} sessions={ended} selectedId={id} />
      </div>
    </aside>
  );
}
