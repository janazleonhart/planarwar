// worldcore/resources/PowerResources.ts

import { CharacterState } from "../characters/CharacterTypes";
import { Logger } from "../utils/logger";

const log = Logger.scope("RESOURCES");

/**
 * v1 resource kinds.
 * We only use fury/mana right now, but this is where chi/energy/focus/song go later.
 */
export type PowerResourceKind = "fury" | "mana";

export interface PowerResourcePool {
  current: number;
  max: number;
}

export type PowerResourceMap = Record<PowerResourceKind, PowerResourcePool>;

/**
 * All resources live inside char.progression.powerResources (JSONB).
 * No schema change needed.
 */
export function ensurePowerResourceMap(char: CharacterState): PowerResourceMap {
  const prog: any = (char.progression as any) || {};

  if (!prog.powerResources) {
    prog.powerResources = {};
    char.progression = prog;
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
    const max = 100;
    // Fury starts empty, mana starts full
    const current = kind === "fury" ? 0 : max;
    pool = { current, max };
    map[kind] = pool;
  }

  return pool;
}

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

export function gainPowerResource(
  char: CharacterState,
  kind: PowerResourceKind,
  amount: number
): void {
  if (amount <= 0) return;

  const pool = getOrInitPowerResource(char, kind);
  pool.current = Math.min(pool.max, pool.current + amount);
}

/**
 * Global “default resource by class” profile.
 * This is where your big class list lives.
 * Abilities/spells can override this per-ability.
 */
export function getPrimaryPowerResourceForClass(
  classId: string | undefined | null
): PowerResourceKind {
  const id = (classId ?? "").toLowerCase();

  // --- Mana casters / hybrids ---
  const manaClasses = new Set<string>([
    // PW caster / hybrid list
    "virtuoso", // bard-style -> later song/mana hybrid
    "illusionist", // enchanter
    "prophet", // shaman
    "crusader", // paladin archetype
    "revenant", // shadow knight archetype
    "hierophant", // druid
    "templar", // cleric
    "defiler", // necromancer
    "conjuror", // magician
    "archmage", // wizard
    "primalist", // beastlord
    "outrider", // ranger

    // Current stub / vanilla-style classes
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

  // --- Fury / physical bruisers ---
  const furyClasses = new Set<string>([
    // PW physicals
    "warlord", // warrior
    "ravager", // berserker
    "cutthroat", // rogue
    "ascetic", // monk
    "adventurer",

    // Current stub / vanilla-style classes
    "warrior",
    "rogue",
    "monk",
    "barbarian",
  ]);

  if (manaClasses.has(id)) return "mana";
  if (furyClasses.has(id)) return "fury";

  // Default: if unknown, assume mana for safety
  return "mana";
}
