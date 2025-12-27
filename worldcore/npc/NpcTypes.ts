// worldcore/npc/NpcTypes.ts

export type NpcId = string;

/**
 * High-level behavior profile for an NPC.
 *
 * - "aggressive": will happily attack valid targets on sight
 * - "neutral": will not auto-attack; may only fight when provoked
 * - "coward": will fight at high HP, but will try to flee when low
 * - "guard": reserved for faction/defender logic later
 */
export type NpcBehavior = "neutral" | "aggressive" | "coward" | "guard";

export interface NpcLootEntry {
  itemId: string; // id in ItemCatalog
  chance: number; // 0–1
  minQty: number;
  maxQty: number;
}

export interface NpcPrototype {
  id: NpcId;
  name: string;
  level: number;

  maxHp: number;
  baseDamageMin: number;
  baseDamageMax: number;

  model?: string; // hook into art later

  /**
   * General tags:
   *  - "training", "beast", "undead", "elite"
   *  - "resource", "resource_ore", etc.
   *  - "non_hostile" for things that should never attack
   */
  tags?: string[];

  // NEW: high-level behavior profile for AI to read
  behavior?: NpcBehavior;

  // NEW: reward & drop info
  xpReward?: number;
  loot?: NpcLootEntry[];
}

/**
 * Runtime NPC state tracked server-side.
 * This is per-entity instance.
 */
export interface NpcRuntimeState {
  entityId: string;

  /** The canonical identity used by quests/progression ("sir_thaddeus") */
  protoId: NpcId;

  /** Which incarnation/version ("epic_step_4") */
  variantId?: string | null;

  /**
   * The resolved prototype key actually used
   * ("sir_thaddeus@epic_step_4" or "sir_thaddeus")
   */
  templateId: NpcId;

  roomId: string;

  hp: number;
  maxHp: number;
  alive: boolean;

  // Bare-minimum combat scaffolding
  lastAggroAt?: number;
  lastAttackerEntityId?: string;
}

// ---------------------------------------------------------------------------
// v1 prototype catalog (hard-coded default seed)
// ---------------------------------------------------------------------------
// Keep these as dev/test seed data only.

export const DEFAULT_NPC_PROTOTYPES: Record<NpcId, NpcPrototype> = {
  training_dummy: {
    id: "training_dummy",
    name: "Training Dummy",
    level: 1,
    maxHp: 200,
    baseDamageMin: 0,
    baseDamageMax: 0,
    model: "training_dummy",
    tags: ["training", "non_hostile"],
    behavior: "neutral",
    xpReward: 0,
    loot: [],
  },

  town_rat: {
    id: "town_rat",
    name: "Town Rat",
    level: 1,
    maxHp: 15,
    baseDamageMin: 1,
    baseDamageMax: 3,
    model: "rat_small",
    tags: ["beast", "critter"],
    behavior: "aggressive",
    xpReward: 8,
    loot: [
      {
        itemId: "rat_tail",
        chance: 0.7,
        minQty: 1,
        maxQty: 2,
      },
      {
        itemId: "rat_meat_raw",
        chance: 0.3,
        minQty: 1,
        maxQty: 1,
      },
    ],
  },

  ore_vein_small: {
    id: "ore_vein_small",
    name: "Hematite Ore Vein",
    level: 1,
    maxHp: 3,
    baseDamageMin: 0,
    baseDamageMax: 0,
    model: "ore_vein_small",
    tags: ["resource", "resource_ore"],
    behavior: "neutral", // non-hostile node, even if someone misuses it later
    xpReward: 0,
    loot: [
      {
        itemId: "ore_iron_hematite",
        chance: 1.0,
        minQty: 1,
        maxQty: 2,
      },
    ],
  },
};

// Live registry (starts from defaults; can be replaced with DB data)
let npcPrototypes: Record<NpcId, NpcPrototype> = {
  ...DEFAULT_NPC_PROTOTYPES,
};

export function setNpcPrototypes(list: NpcPrototype[]): void {
  const bag: Record<NpcId, NpcPrototype> = {};

  for (const proto of list) {
    bag[proto.id] = proto;
  }

  // If DB is empty, keep defaults instead of nuking everything
  npcPrototypes =
    Object.keys(bag).length > 0 ? bag : { ...DEFAULT_NPC_PROTOTYPES };
}

export function getNpcPrototype(id: string): NpcPrototype | undefined {
  return npcPrototypes[id];
}

export function getAllNpcPrototypes(): NpcPrototype[] {
  return Object.values(npcPrototypes);
}

// Backwards compat alias if anything else still imports this name:
export const NPC_PROTOTYPES = npcPrototypes;
