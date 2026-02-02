// worldcore/resources/PowerResources.ts
//
// Power resources (mana/fury/runic_power).
// Stored under char.progression.powerResources (JSON-like).
//
// Conventions:
// - mana starts full (max)
// - fury starts empty (0)
// - runic_power starts empty (0)
// - all v1 pools normalize max=100
//

import type { CharacterState } from "../characters/CharacterTypes";
import { Logger } from "../utils/logger";

const log = Logger.scope("RESOURCES");

export type PowerResourceKind = "fury" | "mana" | "runic_power";

export interface PowerResourcePool {
  current: number;
  max: number;
}

export type PowerResourceMap = Partial<Record<PowerResourceKind, PowerResourcePool>>;

const DEFAULT_MAX = 100;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function normalizePool(kind: PowerResourceKind, pool: PowerResourcePool): PowerResourcePool {
  const max = Number.isFinite(pool.max) && pool.max > 0 ? pool.max : DEFAULT_MAX;
  const current = Number.isFinite(pool.current) ? pool.current : 0;

  // v1 standard: always normalize to DEFAULT_MAX so UI and balance stay consistent.
  const normalizedMax = DEFAULT_MAX;

  const normalizedCurrent = clamp(
    // mana defaults full if it was unset/invalid
    kind === "mana" && !Number.isFinite(pool.current) ? normalizedMax : current,
    0,
    normalizedMax,
  );

  pool.max = normalizedMax;
  pool.current = normalizedCurrent;
  return pool;
}

/**
 * Ensures char.progression.powerResources exists and returns it.
 */
export function ensurePowerResourceMap(char: CharacterState): PowerResourceMap {
  const prog = (char.progression as any) ?? {};
  if (!prog.powerResources) {
    prog.powerResources = {};
    (char as any).progression = prog;
  }
  return prog.powerResources as PowerResourceMap;
}

/**
 * Gets a pool, initializing it if missing and normalizing max/current.
 */
export function getOrInitPowerResource(char: CharacterState, kind: PowerResourceKind): PowerResourcePool {
  const map = ensurePowerResourceMap(char);
  const existing = map[kind];

  if (!existing) {
    const current = kind === "mana" ? DEFAULT_MAX : 0;
    const created: PowerResourcePool = { current, max: DEFAULT_MAX };
    map[kind] = created;
    return created;
  }

  return normalizePool(kind, existing);
}

/**
 * Spend power. Returns a user-facing error on failure; null on success.
 */
export function trySpendPowerResource(char: CharacterState, kind: PowerResourceKind, cost: number): string | null {
  const c = Number(cost);
  if (!Number.isFinite(c) || c <= 0) return null;

  const pool = getOrInitPowerResource(char, kind);

  if (pool.current < c) {
    const label = kind === "runic_power" ? "runic power" : kind;
    return `You don't have enough ${label} (${pool.current}/${c} needed).`;
  }

  pool.current = clamp(pool.current - c, 0, pool.max);
  return null;
}

/**
 * Gain power (clamped to max).
 */
export function gainPowerResource(char: CharacterState, kind: PowerResourceKind, amount: number): void {
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) return;

  const pool = getOrInitPowerResource(char, kind);
  pool.current = clamp(pool.current + a, 0, pool.max);
}

/**
 * Primary resource mapping by class id.
 */
export function getPrimaryPowerResourceForClass(classId: string | undefined | null): PowerResourceKind {
  const id = String(classId ?? "").toLowerCase();

  // Runic power users
  if (id === "runic_knight") return "runic_power";

  // Mana casters / hybrids
  const manaClasses = new Set<string>([
    "virtuoso",
    "illusionist",
    "prophet",
    "crusader",
    "revenant",
    "hierophant",
    "templar",
    "defiler",
    "conjuror",
    "archmage",
    "primalist",
    "outrider",
    // generic/legacy
    "mage",
    "wizard",
    "warlock",
    "priest",
    "cleric",
    "paladin",
    "shaman",
    "druid",
    "hunter",
    "deathknight",
  ]);
  if (manaClasses.has(id)) return "mana";

  // Fury / physical bruisers
  const furyClasses = new Set<string>([
    "warlord",
    "ravager",
    "cutthroat",
    "ascetic",
    "adventurer",
    // generic/legacy
    "warrior",
    "rogue",
    "monk",
    "barbarian",
  ]);
  if (furyClasses.has(id)) return "fury";

  // Safe default
  return "mana";
}
