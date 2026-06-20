// Per-control ⓘ content for the live-tester panel — sourced LIVE from
// next-live-tester's machine-readable catalog `live-test-info.json`
// (mb-next-payment-gateway PR #657, `poc/integration/src/live/`). That file is the
// single source of truth: one entry per test with key/act/title/ac/flag + Thai
// what/why/how/verify. We map a panel control → its tests by the test's `flag`
// field (the env var that gates it), scoped per suite. No hand-transcription here.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PG = join(homedir(), 'Code/github.com/kxlahsimx09/mb-next-payment-gateway');
const REL = 'poc/integration/src/live/live-test-info.json';
const TTL_MS = 5 * 60_000; // re-read at most every 5 min (picks up updates without a restart)

export interface LegInfo { id: string; title?: string; ac?: string; what: string; why: string; how: string; verify: string }
interface RawTest { key: string; act?: string; title?: string; ac?: string; flag?: string; what?: string; why?: string; how?: string; verify?: string }
interface RawSuite { id: string; tests?: RawTest[] }
interface Catalog { suites?: RawSuite[] }

let cache: Catalog | null = null;
let loadedAt = 0;

// Load the catalog: prefer the working-tree file (cheap), else read it straight from
// origin/main (the pg checkout often sits on a campaign branch). Keeps the last good
// value on failure.
function load(): Catalog | null {
  if (cache && Date.now() - loadedAt < TTL_MS) return cache;
  let text = '';
  try { const f = join(PG, REL); if (existsSync(f)) text = readFileSync(f, 'utf8'); } catch { /* fall through */ }
  if (!text) {
    try { text = execFileSync('git', ['-C', PG, 'show', `origin/main:${REL}`], { encoding: 'utf8', timeout: 8000 }); }
    catch { /* repo missing / not fetched */ }
  }
  if (text) { try { cache = JSON.parse(text) as Catalog; } catch { /* keep last good */ } }
  loadedAt = Date.now();
  return cache;
}

/** Force a re-read on the next lookup (e.g. after the pg repo is fetched). */
export function reloadInfo(): void { cache = null; loadedAt = 0; }

/** A (suite, control env) → the tests gated by that flag in that suite (or []). */
export function infoForControl(suiteId: string, env: string): LegInfo[] {
  const cat = load();
  const suite = cat?.suites?.find((s) => s.id === suiteId);
  if (!suite?.tests) return [];
  return suite.tests
    .filter((t) => t.flag === env)
    .map((t) => ({
      id: t.key, title: t.title, ac: t.ac,
      what: t.what || '', why: t.why || '', how: t.how || '', verify: t.verify || '',
    }));
}
