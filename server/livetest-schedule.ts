// Nightly auto-run scheduler for the live-tester. Persists ONE schedule to
// ~/.fleet-town/livetest-schedule.json and, on a 60s tick from the server, fires
// the configured run once per day in a small window after the set time (GMT+7).
// FAST is the safe default (no real money); full/slow move real money — opt-in.
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { startRun, startSequence, getRun } from './livetest';
import { pullMainRepo } from './livetest-git';

const DIR = join(homedir(), '.fleet-town');
const FILE = join(DIR, 'livetest-schedule.json');

export type SchedMode = 'fast' | 'full' | 'slow' | 'cards';
export interface Schedule {
  enabled: boolean;
  time: string;        // "HH:MM" local (Asia/Bangkok)
  mode: SchedMode;
  cards: string[];     // card ids — used when mode === 'cards'
  pullMain: boolean;   // pull origin/main into the primary checkout before running
  lastFired?: string;  // "YYYY-MM-DD" (Bangkok) — dedupe so it fires once per day
  lastResult?: string; // short note from the last trigger (shown in the panel)
}
const DEFAULT: Schedule = { enabled: false, time: '02:00', mode: 'fast', cards: [], pullMain: true };
// full = FAST+SLOW, slow = SLOW only. Both move REAL money (run-catalog gates them).
const MODE_SUITE: Record<'fast' | 'full' | 'slow', string> = { fast: 'ALL-FAST', full: 'ALL-SLOW', slow: 'ALL-SLOW-ONLY' };

export function getSchedule(): Schedule {
  try { return { ...DEFAULT, ...JSON.parse(readFileSync(FILE, 'utf8')) }; }
  catch { return { ...DEFAULT }; }
}
function save(s: Schedule): void {
  try { if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true }); writeFileSync(FILE, JSON.stringify(s, null, 2)); }
  catch { /* best-effort — never throw from the scheduler */ }
}
/** Update the schedule from the panel (sanitised). */
export function setSchedule(patch: Partial<Schedule>): Schedule {
  const cur = getSchedule();
  const next: Schedule = { ...cur, ...patch };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.time)) next.time = cur.time;      // keep a valid HH:MM
  if (!['fast', 'full', 'slow', 'cards'].includes(next.mode)) next.mode = 'fast';
  next.cards = Array.isArray(next.cards) ? next.cards.slice(0, 100) : [];
  save(next);
  return next;
}

// Bangkok wall-clock — robust regardless of the server process TZ.
function bkkNow(): { minutes: number; date: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { minutes: Number(parts.hour) * 60 + Number(parts.minute), date: `${parts.year}-${parts.month}-${parts.day}` };
}

let firing = false;
/** Called ~every 60s by the server. Fires the scheduled run once per day inside a
 *  15-min window after the set time, only when nothing else is already running. */
export async function tickSchedule(): Promise<void> {
  if (firing) return;
  const s = getSchedule();
  if (!s.enabled) return;
  const now = bkkNow();
  const [h, m] = s.time.split(':').map(Number);
  const target = h * 60 + m;
  if (now.date === s.lastFired) return;                            // already fired today
  if (now.minutes < target || now.minutes >= target + 15) return; // outside the fire window
  firing = true;
  try {
    save({ ...s, lastFired: now.date }); // claim the slot up-front so a slow tick can't double-fire
    if (getRun().status === 'running') {
      save({ ...getSchedule(), lastResult: `${now.date} ${s.time}: skipped — a run was already in progress` });
      return;
    }
    if (s.pullMain) { try { pullMainRepo(); } catch { /* run on the current checkout anyway */ } }
    const r = s.mode === 'cards'
      ? await startSequence(s.cards, 'livetest-sched', 'scheduled')
      : await startRun(MODE_SUITE[s.mode], {}, 'livetest-sched', undefined, 'scheduled');
    const note = 'ok' in r ? `started ${s.mode}` : 'held' in r ? 'staging lock held by another agent' : (r as { error: string }).error;
    save({ ...getSchedule(), lastResult: `${now.date} ${s.time}: ${note}` });
  } finally { firing = false; }
}
