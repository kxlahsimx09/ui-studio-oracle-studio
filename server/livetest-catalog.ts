// The live-tester suite catalog (server-owned source of truth; the panel fetches
// it). This is the LIVE Test Journey **v2** card set — see the gateway's
// docs/requirements/live-test-journey-v2.md. Each card is a self-contained
// launcher in poc/integration/ that does the §1.2 lifecycle (lock →
// assertCoreCastReady → reset state+portal → real-API setup → run). The old
// A/B/C/D/DEP suites are retired.
//
// FAST cards (D2–D7) are pure client-wire — no portal, no bot, no money. The SLOW
// cards (D1, P1, D-OWNER) drive the REAL bank-bot against the mock portal and move
// SIM money on staging, so they're owner-gated (⚠ + confirm). The server validates
// a run's env against this so only known flags reach the launcher.

export type ControlType = 'toggle' | 'number' | 'text' | 'select';
export interface Control {
  env: string; label: string; type: ControlType;
  def?: string;            // default value (number/text/select); toggles default off
  options?: string[];      // select choices
  help?: string;
  danger?: boolean;        // needs a confirm (e.g. wipes txns / moves money)
}
export interface Suite {
  id: string; label: string; launcher: string; runtime: string; gate: string;
  ownerGated?: boolean;    // drives the real bot / moves SIM money — extra-guard
  controls: Control[];
}

// v2 cards take only env/secret OVERRIDES (PORTAL_BASE_URL, RECEIVER_BASE_URL,
// SCB_FLEET_FILE, SIM_CONTROL_SECRET, SLOT, CAMPAIGN) — all defaulted by the
// launcher — so there are no per-run knobs to surface; the operator just picks a card.
export const SUITES: Suite[] = [
  { id: 'D1', label: 'D1 · Golden deposit', launcher: 'run-live-d1.sh', runtime: 'SLOW · real bot',
    gate: 'REAL bank-bot golden auto-match · moves SIM money on staging', ownerGated: true, controls: [] },
  { id: 'D2', label: 'D2 · Reject @ validation', launcher: 'run-live-d2.sh', runtime: 'FAST',
    gate: 'client-wire only — no portal / bot / money (+ idempotency)', controls: [] },
  { id: 'D3', label: 'D3 · Reject @ routing/gates', launcher: 'run-live-d3.sh', runtime: 'FAST',
    gate: 'client-wire only — bank-routing & gate negatives', controls: [] },
  { id: 'D4', label: 'D4 · Fraud negatives', launcher: 'run-live-d4.sh', runtime: 'FAST',
    gate: 'client-wire only — approve-time fraud, no credit', controls: [] },
  { id: 'D5', label: 'D5 · Multi-candidate park', launcher: 'run-live-d5.sh', runtime: 'FAST',
    gate: 'client-wire only — collision parks for review', controls: [] },
  { id: 'D6', label: 'D6 · Cancel pending deposit', launcher: 'run-live-d6.sh', runtime: 'FAST',
    gate: 'client-wire only — client deposit-cancel', controls: [] },
  { id: 'D7', label: 'D7 · Read surface + wallet', launcher: 'run-live-d7.sh', runtime: 'FAST',
    gate: 'client-wire only — read surface, tenant-scoped', controls: [] },
  { id: 'P1', label: 'P1 · Golden payout', launcher: 'run-live-p1.sh', runtime: 'SLOW · real bot',
    gate: 'REAL bank-bot full out-lane · money leaves the wallet (SIM)', ownerGated: true, controls: [] },
  { id: 'D-OWNER', label: 'D-OWNER · MDR owner (deposit)', launcher: 'run-live-d-owner.sh', runtime: 'SLOW · real bot',
    gate: 'REAL bank-bot · MDR owner earns both ways, conserved', ownerGated: true, controls: [] },
];

export const suiteById = (id: string) => SUITES.find((s) => s.id === id);

// No cross-cutting globals for the v2 journey: each card self-resets its cast +
// portal in the §1.2 lifecycle, so the old dedicated-stack wipe is retired.
export const GLOBAL_CONTROLS: Control[] = [];

// Validate a raw {env: value} from the panel against the GLOBAL + suite controls →
// the real env to pass the launcher. Unknown keys dropped; toggles only when truthy;
// selects must be a listed option; numbers must be numeric.
export function buildEnv(suiteId: string, raw: Record<string, unknown>): Record<string, string> {
  const s = suiteById(suiteId);
  if (!s) throw new Error(`unknown suite ${suiteId}`);
  const out: Record<string, string> = {};
  for (const c of [...GLOBAL_CONTROLS, ...s.controls]) {
    const v = raw[c.env];
    if (v == null || v === '' || v === false) continue;
    if (c.type === 'toggle') { if (v === true || v === '1' || v === 1) out[c.env] = '1'; }
    else if (c.type === 'number') { if (!Number.isFinite(Number(v))) throw new Error(`${c.env} must be a number`); out[c.env] = String(v); }
    else if (c.type === 'select') { if (!c.options?.includes(String(v))) throw new Error(`${c.env} invalid`); out[c.env] = String(v); }
    else out[c.env] = String(v);
  }
  return out;
}
