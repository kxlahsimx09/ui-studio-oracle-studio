import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getClaudeTranscript, type TranscriptEntry, type TranscriptResponse } from '../api/maw';
import { Spinner } from '../components/ui/Spinner';

const POLL_MS = 4000;

function agoLabel(iso: string): string {
  if (!iso) return '—';
  const diffS = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffS < 60) return `${diffS}s`;
  if (diffS < 3600) return `${Math.floor(diffS / 60)}m`;
  if (diffS < 86400) return `${Math.floor(diffS / 3600)}h`;
  return `${Math.floor(diffS / 86400)}d`;
}

function Bubble({ e }: { e: TranscriptEntry }) {
  const isUser = e.role === 'user';
  return (
    <div className={`mb-3 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-lg px-3 py-2 ${isUser
        ? 'bg-zinc-800 text-zinc-100'
        : 'bg-zinc-950/60 border border-zinc-800 text-zinc-200'}`}>
        <div className="mb-1 flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
          <span>{e.role}</span>
          {e.ts && <span className="opacity-60">{agoLabel(e.ts)}</span>}
          {e.tools && e.tools.length > 0 && (
            <span className="text-emerald-500/70">· {e.tools.join(', ')}</span>
          )}
        </div>
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {e.text || <span className="italic text-zinc-600">(empty)</span>}
        </div>
      </div>
    </div>
  );
}

export function FleetSession() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<TranscriptResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tail, setTail] = useState(50);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await getClaudeTranscript(id!, { tail });
        if (cancelled) return;
        setData(res);
        setError(null);
        setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        setError(String(e?.message || e));
        setLoading(false);
      }
    }
    load();
    const iv = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(iv); };
  }, [id, tail]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [data, autoScroll]);

  if (!id) return null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 text-zinc-200">
      <div className="mb-4 flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <Link to="/fleet" className="text-xs text-zinc-500 hover:text-zinc-300">← Fleet</Link>
          <h1 className="mt-1 truncate font-mono text-sm text-zinc-300">{id}</h1>
          {data?.jsonlPath && (
            <div className="truncate font-mono text-[10px] text-zinc-600">{data.jsonlPath}</div>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className={`rounded px-2 py-0.5 font-mono uppercase text-[10px] ${
            data?.status === 'active' ? 'bg-emerald-900/40 text-emerald-300' :
            data?.status === 'idle' ? 'bg-amber-900/40 text-amber-300' :
            'bg-zinc-800 text-zinc-400'
          }`}>
            {data?.status || '—'}
          </span>
          <label className="flex items-center gap-1 text-zinc-500">
            tail
            <select
              value={tail}
              onChange={e => setTail(Number(e.target.value))}
              className="rounded border border-zinc-800 bg-zinc-900 px-1 py-0.5 text-zinc-300"
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-zinc-500">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={e => setAutoScroll(e.target.checked)}
              className="accent-zinc-400"
            />
            follow
          </label>
        </div>
      </div>

      {loading && <div className="flex justify-center py-12"><Spinner /></div>}
      {error && !loading && (
        <div className="rounded-md border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {data && !loading && (
        <div
          ref={scrollRef}
          className="max-h-[calc(100vh-180px)] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/40 p-4"
        >
          {data.entries.length === 0 ? (
            <div className="py-12 text-center text-sm text-zinc-500">
              No messages in this session yet.
            </div>
          ) : (
            data.entries.map((e, i) => <Bubble key={`${e.ts}-${i}`} e={e} />)
          )}
        </div>
      )}
    </div>
  );
}
