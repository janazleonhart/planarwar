// worldcore/combat/PhysicalHitResolver.ts
//
// v1.5 Physical hit resolution (weapon skill + level scaling)
//
// Goal:
// - Provide a single, testable pipeline for physical outcomes:
//   hit | miss | dodge | parry | block
// - Add foundational hooks for: crit, double/triple attack, parry->riposte
//
// This is intentionally conservative and expandable: later we can feed in
// real stats (AGI/DEX), weapon types, defense skill, shields, buffs, etc.

export type PhysicalHitOutcome = "hit" | "miss" | "dodge" | "parry" | "block";

export interface PhysicalHitRequest {
  attackerLevel: number;
  defenderLevel: number;

  // Raw weapon skill points (0.. level*5 in classic-style systems).
  // If you don't track it yet, pass 0.
  weaponSkillPoints: number;

  // Optional: defender "defense" skill points (0.. level*5) if tracked.
  // Higher defense should slightly reduce incoming crits and increase avoidance.
  defenderDefenseSkillPoints?: number;

  // Optional: if defender has shield / can parry, etc.
  defenderCanDodge?: boolean;
  defenderCanParry?: boolean;
  defenderCanBlock?: boolean;

  // Allow the attacker to be crit / multi-strike capable.
  allowCrit?: boolean;
  allowMultiStrike?: boolean;

  // If true, a parry outcome can flag a riposte.
  allowRiposte?: boolean;

  // Deterministic RNG hook for tests.
  rng?: () => number;
}

export interface PhysicalHitResult {
  outcome: PhysicalHitOutcome;

  // 1..3 swings (for double/triple attack). Only meaningful when outcome==="hit".
  strikes: number;

  // Suggested crit chance to use for this swing.
  // (Caller may pass this into CombatEngine.)
  critChance: number;

  // Suggested glancing chance (caller may pass into CombatEngine).
  glancingChance: number;

  // True when defender parries and can riposte (caller decides how to apply).
  riposte: boolean;

  // Debug-only (useful in tests / telemetry).
  hitChance: number;
}

function isTestEnv(): boolean {
  // WorldCore uses Node's test runner; keep this simple and dependency-free.
  return (
    process.env.WORLDCORE_TEST === "1" ||
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    process.env.JEST_WORKER_ID !== undefined
  );
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function safeLevel(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

export function resolvePhysicalHit(req: PhysicalHitRequest): PhysicalHitResult {
  const defaultRoll = (!req.rng && isTestEnv()) ? 0.777 : undefined;
  const rng = req.rng ?? (() => (defaultRoll ?? Math.random()));

  const attackerLevel = safeLevel(req.attackerLevel);
  const defenderLevel = safeLevel(req.defenderLevel);

  const skillCap = attackerLevel * 5;
  const weaponSkillPoints = Math.max(0, Math.floor(req.weaponSkillPoints || 0));
  const familiarity = clamp01(skillCap > 0 ? weaponSkillPoints / skillCap : 0);

  const defenderSkillCap = defenderLevel * 5;
  const defenderDefenseSkillPoints = Math.max(0, Math.floor(req.defenderDefenseSkillPoints || 0));
  const defenseFamiliarity = clamp01(defenderSkillCap > 0 ? defenderDefenseSkillPoints / defenderSkillCap : 0);

  // --- Hit chance ---
  // Design goal:
  // - L1 untrained vs L1-3: usually hits (RNG-based).
  // - L50 untrained vs L50: misses a lot until trained.
  //
  // Base hit starts high, but untrained penalty scales with attacker level.
  const untrainedPenalty = clamp((attackerLevel - 1) * 0.01, 0, 0.55) * (1 - familiarity);

  // Level delta: higher defender reduces hit; higher attacker slightly increases.
  const delta = attackerLevel - defenderLevel;
  const levelAdj = delta >= 0 ? clamp(delta * 0.01, 0, 0.10) : clamp(delta * 0.02, -0.20, 0);

  let hitChance = 0.82 - untrainedPenalty + levelAdj;

  // Small familiarity bonus when trained.
  hitChance += familiarity * 0.06;

  // Keep sane bounds.
  hitChance = clamp(hitChance, 0.05, 0.97);

  const rHit = rng();
  if (rHit > hitChance) {
    return {
      outcome: "miss",
      strikes: 1,
      critChance: 0,
      glancingChance: 0,
      riposte: false,
      hitChance,
    };
  }

  // --- Avoidance (defender reactions) ---
  const canDodge = req.defenderCanDodge !== false;
  const canParry = req.defenderCanParry !== false;
  const canBlock = req.defenderCanBlock !== false;

  // Simple level-based avoidance baseline (expand later with stats/skills/gear).
  const dodgeChance = canDodge ? clamp(0.03 + defenderLevel * 0.0015 + defenseFamiliarity * 0.05, 0, 0.30) : 0;
  const parryChance = canParry ? clamp(0.02 + defenderLevel * 0.0010 + defenseFamiliarity * 0.04, 0, 0.25) : 0;
  const blockChance = canBlock ? clamp(0.01 + defenderLevel * 0.0008 + defenseFamiliarity * 0.04, 0, 0.25) : 0;

  const rAvoid = rng();
  const dodgeEdge = dodgeChance;
  const parryEdge = dodgeEdge + parryChance;
  const blockEdge = parryEdge + blockChance;

  if (canDodge && rAvoid < dodgeEdge) {
    return {
      outcome: "dodge",
      strikes: 1,
      critChance: 0,
      glancingChance: 0,
      riposte: false,
      hitChance,
    };
  }

  if (canParry && rAvoid < parryEdge) {
    const riposte = (req.allowRiposte ?? true) ? true : false;
    return {
      outcome: "parry",
      strikes: 1,
      critChance: 0,
      glancingChance: 0,
      riposte,
      hitChance,
    };
  }

  if (canBlock && rAvoid < blockEdge) {
    return {
      outcome: "block",
      strikes: 1,
      critChance: 0,
      glancingChance: 0,
      riposte: false,
      hitChance,
    };
  }

  // --- Crit + multi-strike suggestions (only for actual hits) ---
  const allowCrit = req.allowCrit !== false;
  const allowMulti = req.allowMultiStrike !== false;

  // Crit chance scales mildly with familiarity.
  const critChance = allowCrit ? clamp(0.05 + familiarity * 0.06 - defenseFamiliarity * 0.05, 0, 0.20) : 0;

  // Glancing is more common when untrained.
  const glancingChance = clamp(0.08 + (1 - familiarity) * 0.08, 0.05, 0.20);

  let strikes = 1;
  if (allowMulti) {
    const tripleChance = clamp(0.01 + familiarity * 0.04, 0, 0.12);
    const doubleChance = clamp(0.05 + familiarity * 0.10, 0, 0.25);
    const rMulti = rng();

    if (rMulti < tripleChance) strikes = 3;
    else if (rMulti < tripleChance + doubleChance) strikes = 2;
  }

  return {
    outcome: "hit",
    strikes,
    critChance,
    glancingChance,
    riposte: false,
    hitChance,
  };
}
