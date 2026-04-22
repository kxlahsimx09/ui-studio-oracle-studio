import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listClaudeSessions, type ClaudeSession, type ClaudeStatus } from '../api/maw';
import { Spinner } from '../components/ui/Spinner';

const POLL_MS = 5000;

function agoLabel(iso: string): string {
  const diffS = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffS < 60) return `${diffS}s ago`;
  if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
  if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
  return `${Math.floor(diffS / 86400)}d ago`;
}

function statusDot(s: ClaudeStatus): string {
  if (s === 'active') return 'bg-emerald-500 animate-pulse';
  if (s === 'idle') return 'bg-amber-400';
  return 'bg-zinc-600';
}

function initials(s: ClaudeSession): string {
  const src = s.worktree?.name || s.repo?.split('/').pop() || s.sessionId.slice(0, 2);
  return src.slice(0, 2).toUpperCase();
}

function repoLabel(s: ClaudeSession): string {
  if (!s.repo) return '(unknown repo)';
  const parts = s.repo.split('/');
  return parts.slice(-2).join('/');
}

function Desk({ s }: { s: ClaudeSession }) {
  const chair = s.status === 'ended' ? '🪑' : '🧑‍💻';
  const trigger = s.triggeredFrom === 'maw-wake' ? 'maw'
    : s.triggeredFrom === 'tmux' ? 'tmux'
    : s.triggeredFrom === 'desktop' ? 'desktop'
    : s.triggeredFrom === 'shell' ? 'shell' : '?';

  return (
    <Link
      to={`/fleet/${s.sessionId}`}
      className="group block rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 hover:border-zinc-600 hover:bg-zinc-900 transition-colors"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="relative flex h-10 w-10 items-center justify-center rounded-md bg-zinc-800 text-lg">
          {chair}
          <span className={`absolute -right-1 -top-1 h-3 w-3 rounded-full ring-2 ring-zinc-950 ${statusDot(s.status)}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-zinc-500 uppercase tracking-wider">{initials(s)} · {trigger}</div>
          <div className="truncate text-sm font-medium text-zinc-100">{repoLabel(s)}</div>
        </div>
        <div className="text-right text-[10px] font-mono text-zinc-500">{agoLabel(s.lastActivityAt)}</div>
      </div>

      {s.worktree && (
        <div className="mb-2 font-mono text-[11px] text-zinc-400 truncate">
          <span className="text-zinc-600">wt/</span>{s.worktree.name}
          <span className="text-zinc-700"> · </span>
          <span className="text-zinc-500">{s.worktree.branch}</span>
        </div>
      )}

      {s.lastUserMessage && (
        <div className="mb-1 text-xs text-zinc-300">
          <span className="text-zinc-600">user: </span>
          <span className="line-clamp-2 inline">{s.lastUserMessage}</span>
        </div>
      )}
      {s.lastAssistantMessage && (
        <div className="text-xs text-zinc-400">
          <span className="text-zinc-600">assistant: </span>
          <span className="line-clamp-2 inline">{s.lastAssistantMessage}</span>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-[10px] font-mono text-zinc-600">
        <span>pid {s.pid ?? '—'}</span>
        <span className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400">inspect →</span>
      </div>
    </Link>
  );
}

export function Fleet() {
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(noCache = false) {
      try {
        const data = await listClaudeSessions({ nocache: noCache });
        if (cancelled) return;
        setSessions(data.sessions);
        setGeneratedAt(data.generatedAt);
        setError(null);
        setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        setError(String(e?.message || e));
        setLoading(false);
      }
    }
    load();
    const iv = setInterval(() => load(false), POLL_MS);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const active = sessions.filter(s => s.status === 'active');
  const idle = sessions.filter(s => s.status === 'idle');
  const ended = sessions.filter(s => s.status === 'ended');

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 text-zinc-200">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Fleet</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Claude Code agents working across the ecosystem. Click a desk to peek at what they're doing.
          </p>
        </div>
        {generatedAt && (
          <div className="font-mono text-[10px] text-zinc-600">
            refreshed {agoLabel(generatedAt)} · every {POLL_MS / 1000}s
          </div>
        )}
      </div>

      {loading && <div className="flex justify-center py-16"><Spinner /></div>}
      {error && !loading && (
        <div className="rounded-md border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          <div className="font-medium">Fleet data unavailable</div>
          <div className="mt-1 text-xs text-red-400/80">{error}</div>
          <div className="mt-2 text-xs text-zinc-500">
            Is maw-js running on :3456? Studio proxies <code>/api/maw/*</code> to it.
          </div>
        </div>
      )}

      {!loading && !error && sessions.length === 0 && (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/40 py-16 text-center text-sm text-zinc-500">
          No Claude Code sessions found. Open a Claude session in any repo and it'll appear here.
        </div>
      )}

      {!loading && active.length > 0 && (
        <Section label="At their desk" count={active.length} sessions={active} />
      )}
      {!loading && idle.length > 0 && (
        <Section label="Stepped away" count={idle.length} sessions={idle} />
      )}
      {!loading && ended.length > 0 && (
        <Section label="Gone home" count={ended.length} sessions={ended} />
      )}
    </div>
  );
}

function Section({ label, count, sessions }: { label: string; count: number; sessions: ClaudeSession[] }) {
  return (
    <div className="mb-8">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">{label}</h2>
        <span className="text-xs font-mono text-zinc-600">{count}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sessions.map(s => <Desk key={s.sessionId} s={s} />)}
      </div>
    </div>
  );
}
