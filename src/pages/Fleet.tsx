import { useEffect, useMemo, useState } from 'react';
import { listClaudeSessions, type ClaudeSession, type FleetJob } from '../api/maw';
import { OfficeScene, inferRole } from '../components/fleet/OfficeScene';
import { AgentSidebar } from '../components/fleet/AgentSidebar';

const POLL_MS = 2000;

export function Fleet() {
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [jobs, setJobs] = useState<FleetJob[]>([]);
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
        setJobs(data.jobs || []);
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

  // Hide sessions whose repo can't be resolved — maw-js only resolves repo for
  // live PIDs, so ended/deleted sessions surface as role=unknown. Treat them as
  // gone for display purposes (the raw data is still in the API response).
  const visible = useMemo(() => sessions.filter(s => inferRole(s).key !== 'unknown'), [sessions]);

  return (
    <div className="flex h-[calc(100vh-64px)] w-full text-zinc-200">
      <OfficeScene sessions={visible} jobs={jobs} />
      <AgentSidebar
        sessions={visible}
        generatedAt={generatedAt}
        error={error}
        loading={loading}
      />
    </div>
  );
}
