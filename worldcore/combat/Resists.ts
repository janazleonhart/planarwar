// worldcore/combat/Resists.ts
//
// Resist mitigation v1
// - Pure helpers (no world state).
// - Keeps the existing v1 behavior found in CombatEngine:
//     mitigation = min(cap, resist / K)
//     damage *= (1 - mitigation)
//
// Notes:
// - Resist values are treated as a "rating", not a fraction.
//   Example with defaults (K=200, cap=0.75):
//     resist=100 => 50% reduction (mult=0.5)
//     resist>=150 => capped at 75% reduction (mult=0.25)

export type ResistConfig = {
  /** Curve divisor (rating-to-reduction). Default 200. */
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

export function resistMultiplier(resistRaw: number, cfg: ResistConfig = {}): number {
  const k = cfg.k ?? 200;
  const capReduction = cfg.capReduction ?? 0.75;

  const resist = Math.max(0, Number.isFinite(resistRaw) ? resistRaw : 0);
  if (resist <= 0) return 1;

  const reduction = resist / k;
  const capped = clamp(reduction, 0, capReduction);

  return 1 - capped;
}

export function applyResistMitigation(
  damageRaw: number,
  resistRaw: number,
  cfg: ResistConfig = {},
): number {
  const damage = Math.max(0, Number.isFinite(damageRaw) ? damageRaw : 0);
  if (damage <= 0) return 0;

  const mult = resistMultiplier(resistRaw, cfg);
  const reduced = Math.floor(damage * mult);

  const minDamage = cfg.minDamage ?? 0;
  if (minDamage > 0) return Math.max(minDamage, reduced);

  return reduced;
}
