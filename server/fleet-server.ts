// Persistent production server for the Fleet Town (MVP-2).
//
// Unlike the Vite dev plugin, this is an always-on Bun server that serves the
// built studio bundle (dist/) + the live /__fleet/state endpoint. It is meant to
// run behind Caddy (basic-auth + HTTPS) and bind to localhost only.
//
// Town is deliberately ISOLATED from the memory backbone: only the two SPA-gate
// endpoints (/api/health, /api/auth/status) are forwarded to the Oracle API; every
// other /api/* path is refused, so exposing the town never exposes Oracle memory.
//
//   bun server/fleet-server.ts            # FLEET_PORT=8788 by default
import { join, normalize } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { getFleetState } from './fleet-probe';
import { capturePane, sendToPane, sendKey, closePane } from './pane-io';
import { transcriptFor } from './transcript';
import { listRoles, spawnAgent } from './agents';
import { switchAccount } from './account-switch';
import { carryOver } from './carry-over';
import { listBookmarks, addBookmark, removeBookmark, respawnBookmark } from './bookmarks';
import { listLinks, addLink, removeLink } from './agent-links';
import { getDeploy, startDeploy, startPullMain, cancelDeploy } from './deploy';
import { listPlans } from './usage';
import { handlePush, startNotifyLoop } from './push';
import { handleTelegram } from './telegram';
import { getEnvStatus, startEnvProbe } from './env-probe';
import { getUsage } from './usage';
import { getLockState, releaseLock, setDisabled } from './lock-state';
import { getCatalog, getGlobals, getRun, startRun, cancelRun } from './livetest';

const DIST = join(import.meta.dir, '..', 'dist');
const PORT = Number(process.env.FLEET_PORT || 8788);
const HOST = process.env.FLEET_HOST || '127.0.0.1';
const ORACLE = process.env.ORACLE_API_URL || 'http://localhost:47778';
const API_ALLOW = new Set(['/api/health', '/api/auth/status']);

// The studio's host resolver (src/api/host.ts) defaults /api to http://localhost:47778
// (the VIEWER's machine), which fails on a remote origin and trips BackendGate. Seed
// localStorage with the page origin BEFORE the app bundle evaluates so /api resolves
// same-origin → our forwarded /api/health passes the gate (the rest of /api stays 404'd).
const SEED = `<script>try{var k='oracle-studio-host';if(!localStorage.getItem(k))localStorage.setItem(k,location.origin);}catch(e){}</script>`;
// PWA: make /town installable + register the service worker (push display).
// The apple-mobile-web-app-* metas make iOS launch it in STANDALONE mode from the
// Home Screen — required for the Push API (window.PushManager) to be exposed there.
const PWA = [
  `<link rel="manifest" href="/manifest.webmanifest">`,
  `<meta name="theme-color" content="#6a7a30">`,
  `<link rel="apple-touch-icon" href="/icon-192.png">`,
  `<meta name="apple-mobile-web-app-capable" content="yes">`,
  `<meta name="mobile-web-app-capable" content="yes">`,
  `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`,
  `<meta name="apple-mobile-web-app-title" content="Fleet Town">`,
  `<script>if('serviceWorker'in navigator){addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}</script>`,
].join('');
const INDEX_HTML = (await Bun.file(join(DIST, 'index.html')).text()).replace('<head>', '<head>' + SEED + PWA);

const EMPTY = {
  ts: '', host: '', agents: [], teams: [], roads: [],
  counts: { working: 0, idle: 0, offline: 0, teams: 0, agents: 0, waiting: 0 },
};

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p.startsWith('/__fleet/push/')) {
      try {
        const r = await handlePush(req, p);
        if (r) return r;
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }
    if (p.startsWith('/__fleet/telegram')) {
      try {
        const r = await handleTelegram(req, p);
        if (r) return r;
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }

    if (p === '/__fleet/state') {
      try {
        return Response.json(await getFleetState(), { headers: { 'cache-control': 'no-store' } });
      } catch (e) {
        return Response.json({ ...EMPTY, ts: new Date().toISOString(), error: (e as Error).message });
      }
    }

    if (p === '/__fleet/env') {
      return Response.json(getEnvStatus(), { headers: { 'cache-control': 'no-store' } });
    }

    if (p === '/__fleet/usage') {
      return Response.json(await getUsage(), { headers: { 'cache-control': 'no-store' } });
    }

    // Staging-env lock: GET reads holder/disabled; POST {action} lets the owner
    // force-release or toggle the disable (no-lock) mode from the town UI.
    if (p === '/__fleet/lock') {
      if (req.method === 'POST') {
        try {
          const b = (await req.json()) as { action?: 'release' | 'disable' | 'enable' };
          if (b.action === 'release') releaseLock();
          else if (b.action === 'disable') setDisabled('staging', true);
          else if (b.action === 'enable') setDisabled('staging', false);
          else return Response.json({ error: 'unknown action' }, { status: 400 });
          return Response.json({ ok: true, lock: getLockState() });
        } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
      }
      return Response.json(getLockState(), { headers: { 'cache-control': 'no-store' } });
    }

    // Live-tester run panel: GET = suite catalog + current run state; POST {suite,env}
    // launches a run (lock-aware); POST {action:cancel} kills the active run.
    if (p === '/__fleet/livetest') {
      if (req.method === 'POST') {
        try {
          const b = (await req.json()) as { suite?: string; env?: Record<string, unknown>; campaign?: string; action?: string };
          if (b.action === 'cancel') return Response.json(cancelRun());
          const r = await startRun(b.suite || '', b.env || {}, b.campaign || 'livetest');
          return Response.json(r, { status: 'error' in r ? 400 : 200 });
        } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
      }
      return Response.json({ suites: getCatalog(), globals: getGlobals(), run: getRun() }, { headers: { 'cache-control': 'no-store' } });
    }

    if (p === '/__fleet/pane') {
      try {
        const lines = Number(url.searchParams.get('lines')) || undefined;
        return Response.json({ text: capturePane(url.searchParams.get('id') || '', lines) });
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }
    if (p === '/__fleet/transcript') {
      try { return Response.json({ text: transcriptFor(url.searchParams.get('id') || '') }); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }
    if (p === '/__fleet/send' && req.method === 'POST') {
      try {
        const b = (await req.json()) as { id?: string; text?: string; key?: string };
        if (b.key) sendKey(b.id || '', b.key);
        else sendToPane(b.id || '', b.text || '');
        return Response.json({ ok: true });
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }
    if (p === '/__fleet/roles') {
      try { return Response.json({ roles: listRoles(), plans: listPlans() }); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }
    if (p === '/__fleet/new' && req.method === 'POST') {
      try {
        const b = (await req.json()) as { role?: string; slug?: string; planId?: string };
        const out = spawnAgent(b.role || '', b.slug || '', b.planId);
        return Response.json({ ok: true, output: out });
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }
    if (p === '/__fleet/close' && req.method === 'POST') {
      try {
        const b = (await req.json()) as { id?: string };
        closePane(b.id || '');
        return Response.json({ ok: true });
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }
    if (p === '/__fleet/switch-account' && req.method === 'POST') {
      try {
        const b = (await req.json()) as { paneId?: string; planId?: string };
        return Response.json(await switchAccount(b.paneId || '', b.planId || ''));
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }
    if (p === '/__fleet/carry-over' && req.method === 'POST') {
      try {
        const b = (await req.json()) as { paneId?: string };
        return Response.json(await carryOver(b.paneId || ''));
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }
    if (p === '/__fleet/bookmarks') {
      try {
        if (req.method === 'GET') return Response.json({ bookmarks: listBookmarks() });
        if (req.method === 'POST') {
          const b = (await req.json()) as Record<string, string>;
          return Response.json({ ok: true, bookmark: addBookmark({ ...b, savedAt: Date.now() }) });
        }
        if (req.method === 'DELETE') {
          const b = (await req.json()) as { id?: string };
          removeBookmark(b.id || '');
          return Response.json({ ok: true });
        }
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }
    if (p === '/__fleet/links') {
      try {
        if (req.method === 'GET') return Response.json({ links: listLinks() });
        if (req.method === 'POST') {
          const b = (await req.json()) as Record<string, string>;
          return Response.json({ ok: true, link: addLink({ ...b, savedAt: Date.now() }) });
        }
        if (req.method === 'DELETE') {
          const b = (await req.json()) as { id?: string };
          removeLink(b.id || '');
          return Response.json({ ok: true });
        }
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }
    // Staging deploy: GET = current run state (log stream); POST {action} runs
    // the gateway's deploy-staging.sh slice, pulls main on both repos, or cancels.
    if (p === '/__fleet/deploy') {
      try {
        if (req.method === 'GET') return Response.json(getDeploy(), { headers: { 'cache-control': 'no-store' } });
        if (req.method === 'POST') {
          const b = (await req.json()) as { action?: string; mode?: 'full' | 'ui'; dry?: boolean; pull?: boolean };
          if (b.action === 'cancel') return Response.json(cancelDeploy());
          if (b.action === 'pull-main') { const r = startPullMain(); return Response.json(r, { status: 'error' in r ? 400 : 200 }); }
          const r = startDeploy({ mode: b.mode, dry: b.dry, pull: b.pull });
          return Response.json(r, { status: 'error' in r ? 400 : 200 });
        }
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }
    if (p === '/__fleet/respawn' && req.method === 'POST') {
      try {
        const b = (await req.json()) as { id?: string };
        return Response.json({ ok: true, output: respawnBookmark(b.id || '') });
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }

    if (p.startsWith('/api/')) {
      if (API_ALLOW.has(p)) {
        return fetch(ORACLE + p + url.search, { method: req.method, headers: req.headers });
      }
      return Response.json({ error: 'not exposed on the town server' }, { status: 404 });
    }

    // Static dist with SPA fallback so client-side routing (/town) resolves.
    const safe = normalize(p).replace(/^(\.\.(\/|\\|$))+/, '');
    const file = join(DIST, safe);
    if (file.startsWith(DIST) && p !== '/' && existsSync(file) && statSync(file).isFile()) {
      return new Response(Bun.file(file));
    }
    // SPA entry — serve the origin-seeded index.html (see SEED above).
    return new Response(INDEX_HTML, { headers: { 'content-type': 'text/html;charset=utf-8' } });
  },
});

console.log(`fleet-server listening on http://${server.hostname}:${server.port} (dist=${DIST})`);

// Watch the fleet and push notifications (team-idle / agent-waiting) to PWA subscribers.
startNotifyLoop(() => getFleetState());
// Poll staging-env health (server/env-targets.json) for the /town Staging district.
startEnvProbe();
// Usage/quota is fetched ON-DEMAND when the /usage panel opens (getUsage) — no
// background polling, so the town barely touches /api/oauth/usage.
