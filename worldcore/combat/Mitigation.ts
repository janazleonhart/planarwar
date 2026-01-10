// worldcore/combat/Mitigation.ts
//
// Armor / mitigation v1
// - Pure helpers (no world state).
// - Intended ordering (v1):
//   1) compute base damage
//   2) apply reductions (armor/resists)
//   3) apply incoming "damage taken %" modifiers (cowardice / vulnerability / region peril)
//
// Notes:
// - Armor is a generic physical mitigation stat.
// - Reduction curve: reduction = armor / (armor + K)
// - Default K=100 => armor=100 gives 50% reduction
// - Default capReduction=0.75 => never reduce more than 75% via armor alone.

export type MitigationConfig = {
  /** Curve parameter. Larger K => slower mitigation ramp. */
  k?: number;

  /** Maximum reduction fraction [0..1]. Default 0.75 (75%). */
  capReduction?: number;

  /** If damage > 0, clamp final damage to at least this value. Default 0. */
  minDamage?: number;
};

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Returns a multiplier in (0..1], where:
 * - 1.0 means no mitigation
 * - 0.5 means half damage
 */
export function armorMultiplier(armorRaw: number, cfg: MitigationConfig = {}): number {
  const k = cfg.k ?? 100;
  const capReduction = cfg.capReduction ?? 0.75;

  const armor = Math.max(0, Number.isFinite(armorRaw) ? armorRaw : 0);
  if (armor <= 0) return 1;

  const reduction = armor / (armor + k);
  const capped = clamp(reduction, 0, capReduction);

  return 1 - capped;
}

/**
 * Applies armor mitigation to incoming damage.
 * Returns an integer (floored), with optional minDamage clamp.
 */
export function applyArmorMitigation(
  damageRaw: number,
  armorRaw: number,
  cfg: MitigationConfig = {},
): number {
  const damage = Math.max(0, Number.isFinite(damageRaw) ? damageRaw : 0);
  if (damage <= 0) return 0;

  const mult = armorMultiplier(armorRaw, cfg);
  const reduced = Math.floor(damage * mult);

  const minDamage = cfg.minDamage ?? 0;
  if (minDamage > 0) return Math.max(minDamage, reduced);

  return reduced;
}
