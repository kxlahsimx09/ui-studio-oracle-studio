// Fleet role registry — maps Claude sessions to on-screen roles.
//
// Resolution order (see inferRole in OfficeScene.tsx):
//   1. session.role (from maw-js — parsed from opening prompt "ในฐานะ <role>")
//      → look up in ROLES_BY_NAME
//   2. session.repo → ROLES_BY_REPO (fallback when role marker absent)
//   3. UNKNOWN_ROLE (filtered out by Fleet.tsx)
//
// Add a new agent by dropping an entry in the appropriate map.

export interface Role {
  key: string;
  label: string;
  emoji: string;
  color: string;          // Tailwind bg class for avatar
  ringColor: string;      // Tailwind ring class
}

export const ROLES_BY_NAME: Record<string, Role> = {
  'tester': {
    key: 'tester', label: 'tester', emoji: '🧪',
    color: 'bg-rose-600', ringColor: 'ring-rose-400/60',
  },
  'pg-tester': {
    key: 'tester', label: 'pg-tester', emoji: '🧪',
    color: 'bg-rose-600', ringColor: 'ring-rose-400/60',
  },
  'pg-writer': {
    key: 'writer', label: 'pg-writer', emoji: '📝',
    color: 'bg-amber-600', ringColor: 'ring-amber-400/60',
  },
  'technical-writer': {
    key: 'writer', label: 'tech-writer', emoji: '📝',
    color: 'bg-amber-600', ringColor: 'ring-amber-400/60',
  },
  'bot-writer': {
    key: 'writer', label: 'bot-writer', emoji: '📝',
    color: 'bg-amber-600', ringColor: 'ring-amber-400/60',
  },
  'architect': {
    key: 'architect', label: 'architect', emoji: '📐',
    color: 'bg-indigo-600', ringColor: 'ring-indigo-400/60',
  },
  'system-architect': {
    key: 'architect', label: 'architect', emoji: '📐',
    color: 'bg-indigo-600', ringColor: 'ring-indigo-400/60',
  },
  'next-architect': {
    key: 'architect', label: 'architect', emoji: '📐',
    color: 'bg-indigo-600', ringColor: 'ring-indigo-400/60',
  },
  'brew-ops': {
    key: 'brew-ops', label: 'brew-ops', emoji: '🔧',
    color: 'bg-cyan-600', ringColor: 'ring-cyan-400/60',
  },
  'studio': {
    key: 'studio', label: 'studio', emoji: '🎨',
    color: 'bg-fuchsia-600', ringColor: 'ring-fuchsia-400/60',
  },
};

export const ROLES_BY_REPO: Record<string, Role> = {
  'github.com/Soul-Brews-Studio/arra-oracle-v3': ROLES_BY_NAME['brew-ops'],
  'github.com/Soul-Brews-Studio/maw-js': ROLES_BY_NAME['brew-ops'],
  'github.com/Soul-Brews-Studio/ui-studio-oracle-studio': ROLES_BY_NAME['studio'],
  'github.com/Soul-Brews-Studio/oracle-studio': ROLES_BY_NAME['studio'],
  'github.com/kokarat/bank-bot': {
    key: 'bank-bot', label: 'bank-bot', emoji: '🏦',
    color: 'bg-emerald-600', ringColor: 'ring-emerald-400/60',
  },
  'github.com/kokarat/mobiz-payment-gateway': ROLES_BY_NAME['pg-writer'],
  'github.com/kxlahsimx09/mb-next-payment-gateway': ROLES_BY_NAME['architect'],
};

export const UNKNOWN_ROLE: Role = {
  key: 'unknown', label: 'unknown', emoji: '❓',
  color: 'bg-zinc-600', ringColor: 'ring-zinc-500/60',
};
