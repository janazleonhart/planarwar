// worldcore/mud/MudResources.ts

import { CharacterState } from "../characters/CharacterTypes";
import { Logger } from "../utils/logger";

const log = Logger.scope("MUD");

/**
 * Combat resource pools for abilities/spells.
 * v1: just "fury" (warrior-types) and "mana" (casters).
 */
export type PowerResourceKind = "fury" | "mana";

export interface PowerResourcePool {
  current: number;
  max: number;
}

export type PowerResourceMap = Record<PowerResourceKind, PowerResourcePool>;

/**
 * Get or create the powerResources map on char.progression.
 * Stored in JSONB, no DB schema change needed.
 */
export function ensurePowerResourceMap(char: CharacterState): PowerResourceMap {
  const prog: any = char.progression as any;
  if (!prog.powerResources) {
    prog.powerResources = {};
  }
  return prog.powerResources as PowerResourceMap;
}

export function getOrInitPowerResource(
  char: CharacterState,
  kind: PowerResourceKind
): PowerResourcePool {
  const map = ensurePowerResourceMap(char);
  let pool = map[kind];

  if (!pool) {
    // v1 defaults:
    // - fury starts empty and builds up
    // - mana starts full
    const max = 100;
    const current = kind === "fury" ? 0 : max;
    pool = { current, max };
    map[kind] = pool;
  }

  return pool;
}

/**
 * Try to spend resource; returns an error string on failure, or null on success.
 */
export function trySpendPowerResource(
  char: CharacterState,
  kind: PowerResourceKind,
  cost: number
): string | null {
  if (cost <= 0) return null;

  const pool = getOrInitPowerResource(char, kind);
  if (pool.current < cost) {
    const label = kind === "fury" ? "fury" : "mana";
    return `You don't have enough ${label} (${pool.current}/${cost} needed).`;
  }

  pool.current -= cost;
  return null;
}

/**
 * Simple helper to add resource (e.g. on hits, kills, resting).
 */
export function gainPowerResource(
  char: CharacterState,
  kind: PowerResourceKind,
  amount: number
) {
  if (amount <= 0) return;
  const pool = getOrInitPowerResource(char, kind);
  pool.current = Math.min(pool.max, pool.current + amount);
}

/**
 * Very rough v1 mapping: which resource a class *usually* uses.
 * (We can refine as we flesh out the class grid.)
 */
export function getPrimaryPowerResourceForClass(
  classId: string
): PowerResourceKind {
  const id = (classId ?? "").toLowerCase();

  // Melee-ish
  if (
    [
      "warrior",
      "champion",
      "crusader",
      "revenant",
      "warden",
      "ascetic",
    ].includes(id)
  ) {
    return "fury";
  }

  // Default everything else to mana for now
  return "mana";
}
