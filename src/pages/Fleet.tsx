import { useEffect, useState } from 'react';
import { listClaudeSessions, type ClaudeSession } from '../api/maw';
import { OfficeScene } from '../components/fleet/OfficeScene';
import { AgentSidebar } from '../components/fleet/AgentSidebar';

const POLL_MS = 5000;

export function Fleet() {
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await listClaudeSessions();
        if (cancelled) return;
        setSessions(data.sessions);
        setGeneratedAt(data.generatedAt);
        setError(null);
        setLoading(false);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    }
    load();
    const iv = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  return (
    <div className="flex h-[calc(100vh-64px)] w-full text-zinc-200">
      <OfficeScene sessions={sessions} />
      <AgentSidebar
        sessions={sessions}
        generatedAt={generatedAt}
        error={error}
        loading={loading}
      />
    </div>
  );
}
