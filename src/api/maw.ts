// maw-js API client — proxied via /api/maw/* (see vite.config.ts + bin/serve.ts).
// Backs the Fleet page (Claude Code session lens).

const MAW_BASE = '/api/maw';

export type ClaudeTrigger = 'maw-wake' | 'tmux' | 'desktop' | 'shell' | 'unknown';
export type ClaudeStatus = 'active' | 'idle' | 'ended';

export interface ClaudeSession {
  sessionId: string;
  projectDir: string;
  cwd: string | null;
  repo: string | null;
  worktree: { name: string; branch: string } | null;
  pid: number | null;
  ppid: number | null;
  parentChain: string[];
  triggeredFrom: ClaudeTrigger;
  status: ClaudeStatus;
  lastActivityAt: string;
  lastUserMessage: string | null;
  lastAssistantMessage: string | null;
  role?: string | null;  // From maw-js role extraction — optional until server ships the field.
  sizeBytes: number;
  jsonlPath: string;
}

export type JobKind = 'regression' | 'single-test';

export interface FleetJob {
  kind: JobKind;
  pid: number;
  startedAt: string;
  runId?: string;
  runDir?: string;
  singleTest?: string;
  script: string;
}

export interface FleetListResponse {
  sessions: ClaudeSession[];
  jobs?: FleetJob[];
  total: number;
  generatedAt: string;
}

export interface TranscriptEntry {
  ts: string;
  role: 'user' | 'assistant';
  text: string;
  tools?: string[];
  sessionId?: string;
}

export interface TranscriptResponse {
  sessionId: string;
  jsonlPath: string;
  status: ClaudeStatus;
  total: number;
  entries: TranscriptEntry[];
}

export async function listClaudeSessions(opts: { nocache?: boolean } = {}): Promise<FleetListResponse> {
  const qs = opts.nocache ? '?nocache=true' : '';
  const res = await fetch(`${MAW_BASE}/fleet/claude${qs}`);
  if (!res.ok) throw new Error(`fleet/claude HTTP ${res.status}`);
  return res.json();
}

export async function getClaudeTranscript(sessionId: string, opts: { tail?: number; raw?: boolean } = {}): Promise<TranscriptResponse> {
  const p = new URLSearchParams();
  if (opts.tail) p.set('tail', String(opts.tail));
  if (opts.raw) p.set('raw', 'true');
  const qs = p.toString() ? `?${p.toString()}` : '';
  const res = await fetch(`${MAW_BASE}/fleet/claude/${encodeURIComponent(sessionId)}/transcript${qs}`);
  if (!res.ok) throw new Error(`fleet transcript HTTP ${res.status}`);
  return res.json();
}
