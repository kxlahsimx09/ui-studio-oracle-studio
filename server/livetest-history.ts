// Persisted live-test run history for Fleet Town. Every finished run/sequence is
// appended as one JSON line to ~/.fleet-town/livetest-history.jsonl so the panel
// can show past results with clear timestamps long after the live run state is
// gone (the run state itself is in-memory and holds only the latest run).
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, readdirSync, statSync, appendFileSync, mkdirSync } from 'node:fs';
import type { RunState } from './livetest';

const DIR = join(homedir(), '.fleet-town');
const FILE = join(DIR, 'livetest-history.jsonl');
const HISTORY_MAX = 300; // cap how much of the tail we keep / read

export interface HistoryCard { id: string; color?: string; rc?: number }
export interface HistoryEntry {
  id: string;                          // startedAt (ms) as a stable id
  suite: string;                       // suite id, or "cards: D1,D2,…"
  label?: string;
  trigger: 'manual' | 'scheduled';
  campaign?: string;
  startedAt: number; endedAt: number;
  exitCode: number | null;
  colors: { green: number; amber: number; red: number }; // batch/sequence rollup
  cards?: HistoryCard[];
  evidenceDir?: string;
}

/** Roll a finished RunState up into a history entry and append it (best-effort). */
export function recordFromRun(run: RunState, trigger: 'manual' | 'scheduled', label?: string): void {
  const p = run.progress;
  let colors = { green: 0, amber: 0, red: 0 };
  let cards: HistoryCard[] | undefined;
  if (p && p.length) {
    cards = p.map((x) => ({ id: x.id, color: x.color, rc: x.rc }));
    for (const x of p) {
      if (x.color === 'green') colors.green++;
      else if (x.color === 'red') colors.red++;
      else colors.amber++;
    }
  } else {
    const ok = run.exitCode === 0;
    colors = { green: ok ? 1 : 0, amber: 0, red: ok ? 0 : 1 };
  }
  const e: HistoryEntry = {
    id: String(run.startedAt || run.endedAt || 0),
    suite: run.suite || '?', label,
    trigger, campaign: run.campaign,
    startedAt: run.startedAt || 0, endedAt: run.endedAt || 0,
    exitCode: run.exitCode ?? null, colors, cards, evidenceDir: run.evidenceDir,
  };
  try {
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
    appendFileSync(FILE, JSON.stringify(e) + '\n');
  } catch { /* history is best-effort — never break a run over it */ }
}

/** Past runs, most-recent-first, capped. */
export function getHistory(limit = 50): HistoryEntry[] {
  try {
    const lines = readFileSync(FILE, 'utf8').split('\n').filter(Boolean).slice(-HISTORY_MAX);
    const out: HistoryEntry[] = [];
    for (const l of lines) { try { out.push(JSON.parse(l)); } catch { /* skip a bad line */ } }
    return out.reverse().slice(0, limit);
  } catch { return []; }
}

// Best-effort: the most recently modified legs.json under <dir>/evidence/ — the
// run's produced evidence, linked from the run state + history entry.
export function latestLegs(dir: string): { legs: unknown; dir: string } | null {
  const root = join(dir, 'evidence');
  if (!existsSync(root)) return null;
  let best: { f: string; m: number } | null = null;
  const walk = (d: string, depth: number) => {
    if (depth > 6) return;
    let ents: string[]; try { ents = readdirSync(d); } catch { return; }
    for (const e of ents) {
      const p = join(d, e); let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (e === 'legs.json' && (!best || st.mtimeMs > best.m)) best = { f: p, m: st.mtimeMs };
    }
  };
  walk(root, 0);
  if (!best) return null;
  try { return { legs: JSON.parse(readFileSync(best.f, 'utf8')), dir: best.f.replace(/\/legs\.json$/, '') }; }
  catch { return null; }
}
