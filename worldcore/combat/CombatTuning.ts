// worldcore/combat/CombatTuning.ts
//
// Centralized env-driven tuning knobs for combat math.
//
// Design goals:
// - Safe parsing (no NaN leaks)
// - Explicit clamping
// - One place to adjust defaults without hunting across CombatEngine.

export interface CombatTuning {
  // Crit
  critChanceBase: number; // 0..1
  critMultiplier: number; // >= 1

  // Glancing
  glancingChanceBase: number; // 0..1
  glancingMultiplier: number; // 0..1

  // Parry
  parryEnabled: boolean;
  parryChanceBase: number; // 0..1

  // Block
  blockEnabled: boolean;
  blockChanceBase: number; // 0..1
  blockMultiplier: number; // 0..1
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function envNumber(name: string, fallback: number): number {
  const raw = String((process.env as any)?.[name] ?? "").trim();
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = String((process.env as any)?.[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(raw)) return true;
  if (["0", "false", "no", "n", "off"].includes(raw)) return false;
  return fallback;
}

// Default values mirror the previous CombatEngine defaults.
const DEFAULTS: CombatTuning = {
  critChanceBase: 0.05,
  critMultiplier: 1.5,

  glancingChanceBase: 0.1,
  glancingMultiplier: 0.7,

  parryEnabled: false,
  parryChanceBase: 0.0,

  blockEnabled: false,
  blockChanceBase: 0.0,
  blockMultiplier: 0.7,
};

/**
 * Reads combat tuning knobs from environment variables.
 *
 * Supported knobs:
 * - PW_CRIT_CHANCE_BASE (default 0.05)
 * - PW_CRIT_MULTIPLIER  (default 1.5)
 * - PW_GLANCE_CHANCE_BASE (default 0.10)
 * - PW_GLANCE_MULTIPLIER  (default 0.70)
 * - PW_PARRY_ENABLED (default false)
 * - PW_PARRY_CHANCE_BASE (default 0.00)
 * - PW_BLOCK_ENABLED (default false)
 * - PW_BLOCK_CHANCE_BASE (default 0.00)
 * - PW_BLOCK_MULTIPLIER (default 0.70)
 */
export function getCombatTuningFromEnv(): CombatTuning {
  return {
    critChanceBase: clamp01(envNumber("PW_CRIT_CHANCE_BASE", DEFAULTS.critChanceBase)),
    critMultiplier: clamp(envNumber("PW_CRIT_MULTIPLIER", DEFAULTS.critMultiplier), 1.0, 5.0),

    glancingChanceBase: clamp01(envNumber("PW_GLANCE_CHANCE_BASE", DEFAULTS.glancingChanceBase)),
    glancingMultiplier: clamp(envNumber("PW_GLANCE_MULTIPLIER", DEFAULTS.glancingMultiplier), 0.05, 1.0),

    parryEnabled: envBool("PW_PARRY_ENABLED", DEFAULTS.parryEnabled),
    parryChanceBase: clamp01(envNumber("PW_PARRY_CHANCE_BASE", DEFAULTS.parryChanceBase)),

    blockEnabled: envBool("PW_BLOCK_ENABLED", DEFAULTS.blockEnabled),
    blockChanceBase: clamp01(envNumber("PW_BLOCK_CHANCE_BASE", DEFAULTS.blockChanceBase)),
    blockMultiplier: clamp(envNumber("PW_BLOCK_MULTIPLIER", DEFAULTS.blockMultiplier), 0.05, 1.0),
  };
}
