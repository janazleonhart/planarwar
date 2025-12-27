// worldcore/npc/NpcTypes.ts

export type NpcId = string;

/**
 * High-level behavior profile for an NPC.
 *
 * - "aggressive": attacks valid targets on sight
 * - "neutral": never auto-attacks (may retaliate later)
 * - "coward": will fight briefly, then try to flee when hurt
 * - "guard": aggressive, but with future faction checks
 * - "testing": free slot for dev experiments
 */
export type NpcBehavior =
  | "neutral"
  | "aggressive"
  | "coward"
  | "guard"
  | "testing";

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

  model?: string;

  /**
   * Tags like:
   *  - "training", "beast", "undead", "elite"
   *  - "resource", "resource_ore"
   *  - "non_hostile"
   */
  tags?: string[];

  behavior?: NpcBehavior;

  xpReward?: number;
  loot?: NpcLootEntry[];
}

/**
 * Runtime NPC state tracked server-side.
 */
export interface NpcRuntimeState {
  entityId: string;

  protoId: NpcId;    // identity – e.g. "coward_rat"
  templateId: NpcId; // actual prototype key used
  variantId?: string | null;

  roomId: string;

  hp: number;
  maxHp: number;
  alive: boolean;

  lastAggroAt?: number;
  lastAttackerEntityId?: string;

  // For simple behavior flags; coward only uses this for now
  fleeing?: boolean;
}

// ---------------------------------------------------------------------------
// Hard-coded defaults (dev seed / fallback)
// ---------------------------------------------------------------------------

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

  coward_rat: {
    id: "coward_rat",
    name: "Cowardly Rat",
    level: 1,
    maxHp: 200, // chunky for testing; tune later
    baseDamageMin: 1,
    baseDamageMax: 3,
    model: "rat_small",
    tags: ["beast", "critter", "coward_test"],
    behavior: "coward",
    xpReward: 10,
    loot: [
      {
        itemId: "rat_tail",
        chance: 0.7,
        minQty: 1,
        maxQty: 2,
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
    behavior: "neutral",
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

// live registry (DB + defaults merged)
let npcPrototypes: Record<NpcId, NpcPrototype> = {
  ...DEFAULT_NPC_PROTOTYPES,
};

/**
 * Merge DB-provided prototypes on top of defaults.
 * DB wins for overlapping IDs, but defaults still exist for dev-only IDs
 * like "coward_rat".
 */
export function setNpcPrototypes(list: NpcPrototype[]): void {
  const bag: Record<NpcId, NpcPrototype> = {
    ...DEFAULT_NPC_PROTOTYPES,
  };

  for (const proto of list) {
    const existing = bag[proto.id];
    bag[proto.id] = existing ? { ...existing, ...proto } : proto;
  }

  npcPrototypes = bag;
}

export function getNpcPrototype(id: string): NpcPrototype | undefined {
  return npcPrototypes[id];
}

export function getAllNpcPrototypes(): NpcPrototype[] {
  return Object.values(npcPrototypes);
}

// legacy alias, in case anything still expects this name
export const NPC_PROTOTYPES = npcPrototypes;
