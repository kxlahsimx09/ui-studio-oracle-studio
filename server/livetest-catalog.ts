// The live-tester suite + option catalog (server-owned source of truth; the panel
// fetches it). Mirrors the next-live-tester run contract (handoff 2026-06-20_09-38
// + skill references/run-live-suite-flags.md). The server validates a run's env
// against this so only known flags reach the launcher.

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
  ownerGated?: boolean;    // moves SIM money — extra-guard
  controls: Control[];
}

const T = (env: string, label: string, help?: string, danger = false): Control => ({ env, label, type: 'toggle', help, danger });
const N = (env: string, label: string, def: string, help?: string): Control => ({ env, label, type: 'number', def, help });

export const SUITES: Suite[] = [
  {
    id: 'A', label: 'A — Tri-Epic', launcher: 'run-live-tri-epic.sh', runtime: '5–20 min',
    gate: 'OWNER-GATED money (per-epic OWNER_GO_*; none set ⇒ DRY-VALIDATE)', ownerGated: true,
    controls: [
      T('OWNER_GO_LIVE_ALL', 'Run ALL epics', 'AUTH+BBOT+DEPOSIT+PAYOUT+MT+KTB + enforce', true),
      T('OWNER_GO_LIVE_AUTH', 'AUTH', 'ACT I — login/2FA/AAL2/RBAC/lockout', true),
      T('OWNER_GO_LIVE_BBOT', 'BANK-BOT', 'ACT B — bot seam', true),
      T('OWNER_GO_LIVE_DEPOSIT', 'DEPOSIT', 'ACT II — create→match→credit→MDR', true),
      T('OWNER_GO_LIVE_PAYOUT', 'PAYOUT', 'ACT III — freeze→claim→settle', true),
      T('OWNER_GO_LIVE_MT', 'Multi-tenant', 'ACT MT — sub-client + concurrency', true),
      T('OWNER_GO_LIVE_KTB', 'KTB lane', 'ACT KTB — second-bank dialect', true),
      T('OWNER_GO_LIVE_ENFORCE', 'Enforce-only', 'LIGHT system-bank enforce legs — NO money, safe anytime'),
      { env: 'RECEIVER_BASE_URL', label: 'Receiver', type: 'select', def: 'deployed', options: ['deployed', 'local'], help: 'deployed mock-merchant, or local + cloudflared tunnel' },
      { env: 'KEEP_ALERTS_API', label: 'Keep alerts API', type: 'text', help: 'set ⇒ confirm P2.12/16/17 alerts in-harness (needs KEEP_API_KEY)' },
    ],
  },
  {
    id: 'B', label: 'B — Automatch', launcher: 'run-live-bbot.sh', runtime: '~15 min',
    gate: 'SIM money on synthetic accounts — runs legs directly',
    controls: [
      T('SKIP_PARK', 'Skip: multi-candidate park (L1g)'), T('SKIP_DEGEN', 'Skip: degenerate FIFO (L1g2)'),
      T('SKIP_EXPIRE', 'Skip: deposit expiry (L1h)'), T('SKIP_DEP_IDEM', 'Skip: deposit idempotency (L1m)'),
      T('SKIP_DEP_CANCEL', 'Skip: client deposit-cancel (L1j)'), T('SKIP_MDR', 'Skip: MDR 2-profile (L1n)'),
      T('SKIP_CBSIG', 'Skip: callback signature (L1i)'), T('SKIP_WITHDRAW', 'Skip: withdraw lane (L4/L4b)'),
      T('SKIP_STALE', 'Skip: stale payout cancel (L4f)'), T('SKIP_MAINT', 'Skip: maintenance cancel (L4m)'),
      T('SKIP_PAY_IDEM', 'Skip: payout idempotency (L4k)'), T('SKIP_DEADLETTER', 'Skip: dead-letter alert (L2c)'),
      N('DEPOSIT_COUNT', 'Deposit count', '3', 'anchor + batch; 1 ⇒ L1f batch skipped'),
      N('WITHDRAW_COUNT', 'Withdraw count', '3', 'SCB batch; 1 ⇒ single L4 lane'),
      { env: 'WITHDRAW_AMOUNT', label: 'Withdraw amount', type: 'number', help: 'pin payout amount (else random 1200–1799)' },
      T('ROTATE_STRETCH', 'Rotate stretch (L3)', 'mid-journey bot-credential rotate — coordinate'),
      T('BBOT_MINIMIZE_CAST', 'Minimize admin view', 'prunes to bbot cast — DO NOT run with Suite A', true),
      { env: 'CALLBACK_FAIL_PATH', label: 'Callback fail path', type: 'text', def: '/fail', help: 'the always-500 route the dead-letter leg binds to' },
    ],
  },
  {
    id: 'C', label: 'C — Restart', launcher: 'run-live-bbot-restart.sh', runtime: '~10–15 min',
    gate: 'needs BOT_RESTART_CMD preset + remote bot mode, else legs honest-SKIP',
    controls: [T('SKIP_DUPFAULT', 'Skip: crash-restart dedup (L2a)'), T('SKIP_RECONCILE', 'Skip: payout reconcile (P1+P2)')],
  },
  {
    id: 'D', label: 'D — Fair-router', launcher: 'run-live-bbot-fairrouter.sh', runtime: '~10–25 min',
    gate: 'needs the 3-account fleet (scb-fleet.json); <3 ⇒ honest-SKIP',
    controls: [
      N('FAIRROUTER_N', 'Tx per lane', '9', '≥3; 9 = 3/account'),
      { env: 'FAIRROUTER_CLAIM', label: 'Claim mode', type: 'select', def: 'drive', options: ['drive', 'observe'], help: 'drive = fast (rows sit claimed); observe = real ~6-min metronome' },
      T('FAIRROUTER_FORCE_SETTLE', 'Force settle', 'drive mark_success so FRP3 asserts in ~80s'),
      T('FAIRROUTER_CROSSBANK', 'Cross-bank', 'mixed 3 SCB + 1 KTB (payout-only) → FRX gate'),
      N('FAIRROUTER_FUND_FLOOR', 'Fund floor', '0', 'raise each fleet balance ≥ floor; 0 = leave funded'),
      T('FAIRROUTER_NO_EQUALIZE', 'No equalize', 'skip zeroing LRU counters'),
      T('SKIP_DEPOSIT', 'Payout lane only'), T('SKIP_PAYOUT', 'Deposit lane only'),
    ],
  },
  {
    id: 'DEP', label: 'DEP — Deposit golden', launcher: 'run-live-deposit.sh', runtime: '~5 min',
    gate: 'OWNER-GATED (OWNER_GO_LIVE_DEPOSIT); unset ⇒ DRY-VALIDATE', ownerGated: true,
    controls: [
      T('OWNER_GO_LIVE_DEPOSIT', 'Run (owner-GO)', 'required to do anything (else DRY-VALIDATE)', true),
      { env: 'KEEP_ALERTS_API', label: 'Keep alerts API', type: 'text', help: 'confirm the F-iii P2.12 alert in-harness' },
    ],
  },
];

export const suiteById = (id: string) => SUITES.find((s) => s.id === id);

// GLOBAL controls — apply to EVERY suite (cross-cutting), rendered in their own
// section and passed to whichever launcher runs. LIVE_DEDICATED_STACK (wipe staging
// txns at START) is a per-run mode, not a per-suite leg, so it lives here.
export const GLOBAL_CONTROLS: Control[] = [
  T('LIVE_DEDICATED_STACK', 'Dedicated-stack wipe', '⚠ wipes ALL staging txns at START (keeps config). OFF = append mode', true),
];

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
