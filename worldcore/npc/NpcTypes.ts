// worldcore/npc/NpcTypes.ts

/**
 * NPC prototype/runtime types and the default prototype registry used by
 * in-memory AI. Includes guard call radius helpers and built-in test NPCs.
 */

export type NpcId = string;

export type GuardProfile = "village" | "town" | "city";

/**
 * High-level behavior profile for an NPC.
 *
 * - "aggressive": attacks valid targets on sight
 * - "neutral": never auto-attacks (may retaliate later via other systems)
 * - "coward": will fight briefly, then try to flee when hurt
 * - "guard": aggressive, but with future faction / protection checks
 * - "testing": free slot for dev experiments
 */
export type NpcBehavior =
  | "neutral"
  | "aggressive"
  | "coward"
  | "guard"
  | "testing";

export interface NpcLootEntry {
  itemId: string;      // id in ItemCatalog
  chance: number;      // 0–1
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
   * - "training", "beast", "undead", "elite"
   * - "resource", "resource_ore"
   * - "non_hostile"
   */
  tags?: string[];

  behavior?: NpcBehavior;
  guardProfile?: GuardProfile;
  guardCallRadius?: number;

  groupId?: string;
  canCallHelp?: boolean;
  socialRange?: number;
  canGate?: boolean;

  xpReward?: number;
  loot?: NpcLootEntry[];
}

/**
 * Runtime NPC state tracked server-side.
 */
export interface NpcRuntimeState {
  entityId: string;

  // identity – e.g. "coward_rat"
  protoId: NpcId;

  // actual prototype key used
  templateId: NpcId;

  variantId?: string | null;
  roomId: string;

  hp: number;
  maxHp: number;
  alive: boolean;

  lastAggroAt?: number;
  lastAttackerEntityId?: string;

  // For simple behavior flags; coward only uses this for now
  fleeing?: boolean;

  spawnRoomId?: string;
  gating?: boolean;
}

export const DEFAULT_GUARD_CALL_RADIUS: Record<GuardProfile, number> = {
  village: 12,
  town: 18,
  city: 24,
};

export function getGuardCallRadius(
  profile?: GuardProfile,
  override?: number
): number | undefined {
  if (typeof override === "number") return override;
  if (!profile) return undefined;
  return DEFAULT_GUARD_CALL_RADIUS[profile];
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

  // Big immortal-ish dummy for DPS testing.
  training_dummy_big: {
    id: "training_dummy_big",
    name: "Sturdy Training Dummy",
    level: 1,
    maxHp: 10000,
    baseDamageMin: 0,
    baseDamageMax: 0,
    model: "training_dummy",
    tags: ["training", "non_hostile", "testing"],
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
    tags: ["beast", "critter", "protected_town"],
    // no more spawn-camping: town rat is now neutral
    behavior: "neutral",
    xpReward: 8,
    loot: [
      { itemId: "rat_tail", chance: 0.7, minQty: 1, maxQty: 2 },
      { itemId: "rat_meat_raw", chance: 0.3, minQty: 1, maxQty: 1 },
    ],
  },

  coward_rat: {
    id: "coward_rat",
    name: "Cowardly Rat",
    level: 1,
    // chunky for testing; tune later
    maxHp: 200,
    baseDamageMin: 1,
    baseDamageMax: 3,
    model: "rat_small",
    tags: ["beast", "critter", "coward_test", "protected_town", "civilian"],
    behavior: "coward",
    groupId: "rat_pack",
    canCallHelp: true,
    socialRange: 10,
    xpReward: 10,
    loot: [
      { itemId: "rat_tail", chance: 0.7, minQty: 1, maxQty: 2 },
    ],
  },

  // ---------------------------------------------------------------------------
  // Codex Goblin – dedicated combat test mob
  // ---------------------------------------------------------------------------
  codex_goblin: {
    id: "codex_goblin",
    name: "Codex Goblin",
    level: 5,
    maxHp: 400,                 // ~12 base damage via 3% maxHp
    baseDamageMin: 0,
    baseDamageMax: 0,           // we use computeNpcMeleeDamage instead
    model: "goblin_melee",      // placeholder; client can map this however
    tags: ["hostile", "codex", "test_mob"],
    behavior: "neutral",
    xpReward: 25,
    loot: [],                   // no real loot yet; pure test dummy
  },

  // ---------------------------------------------------------------------------
  // Resource nodes (gatherable world objects)
  // These are inert, non-hostile “node NPCs” placed by the ResourceBaseline
  // planner. Gathering logic (mine/pick/etc.) uses the resource_* tags below.
  // ---------------------------------------------------------------------------

  herb_peacebloom: {
    id: "herb_peacebloom",
    name: "Peacebloom Patch",
    level: 1,
    maxHp: 1,
    baseDamageMin: 0,
    baseDamageMax: 0,
    model: "node_herb_peacebloom", // placeholder / client-side model
    // 'resource_herb' is what the 'pick' command looks for.
    tags: ["resource", "resource_herb", "herb", "gatherable", "non_hostile"],
    behavior: "neutral",
    xpReward: 0,
    loot: [], // gathering decides what item(s) you actually get
  },

  ore_iron_hematite: {
    id: "ore_iron_hematite",
    name: "Hematite Iron Vein",
    level: 1,
    maxHp: 1,
    baseDamageMin: 0,
    baseDamageMax: 0,
    model: "node_ore_iron_hematite",
    // 'resource_ore' is what mine/farm/fish/lumber/quarry look for right now.
    tags: ["resource", "resource_ore", "ore", "gatherable", "non_hostile"],
    behavior: "neutral",
    xpReward: 0,
    loot: [],
  },

  stone_granite: {
    id: "stone_granite",
    name: "Granite Outcrop",
    level: 1,
    maxHp: 1,
    baseDamageMin: 0,
    baseDamageMax: 0,
    model: "node_stone_granite",
    // For now granite is also treated as 'resource_ore' so quarrying/mining see it.
    tags: ["resource", "resource_ore", "stone", "gatherable", "non_hostile"],
    behavior: "neutral",
    xpReward: 0,
    loot: [],
  },

  wood_oak: {
    id: "wood_oak",
    name: "Oak Timber Stand",
    level: 1,
    maxHp: 1,
    baseDamageMin: 0,
    baseDamageMax: 0,
    model: "node_wood_oak",
    // Lumbering is currently wired through mining/resource_ore as well.
    tags: ["resource", "resource_ore", "wood", "gatherable", "non_hostile"],
    behavior: "neutral",
    xpReward: 0,
    loot: [],
  },

  fish_river_trout: {
    id: "fish_river_trout",
    name: "River Trout Pool",
    level: 1,
    maxHp: 1,
    baseDamageMin: 0,
    baseDamageMax: 0,
    model: "node_fish_river_trout",
    // Fishing command currently reuses mining/resource_ore under the hood.
    tags: ["resource", "resource_ore", "fish", "gatherable", "non_hostile"],
    behavior: "neutral",
    xpReward: 0,
    loot: [],
  },

  grain_wheat: {
    id: "grain_wheat",
    name: "Wild Wheat Patch",
    level: 1,
    maxHp: 1,
    baseDamageMin: 0,
    baseDamageMax: 0,
    model: "node_grain_wheat",
    // Farming also goes through mining/resource_ore placeholder for now.
    tags: ["resource", "resource_ore", "grain", "gatherable", "non_hostile"],
    behavior: "neutral",
    xpReward: 0,
    loot: [],
  },

  mana_spark_arcane: {
    id: "mana_spark_arcane",
    name: "Arcane Spark Cluster",
    level: 1,
    maxHp: 1,
    baseDamageMin: 0,
    baseDamageMax: 0,
    model: "node_mana_spark_arcane",
    // Mana crystals ride the same 'resource_ore' rail until we split them out.
    tags: [
      "resource",
      "resource_ore",
      "mana",
      "arcane",
      "gatherable",
      "non_hostile",
    ],
    behavior: "neutral",
    xpReward: 0,
    loot: [],
  },

  // Simple guard stub – currently behaves like an aggressive NPC,
  // but uses the "guard" behavior slot so we can special-case it later.
  town_guard: {
    id: "town_guard",
    name: "Town Guard",
    level: 10,
    maxHp: 250,
    baseDamageMin: 8,
    baseDamageMax: 14,
    model: "human_guard",
    tags: ["humanoid", "guard", "town"],
    behavior: "guard",
    guardProfile: "town",
    guardCallRadius: DEFAULT_GUARD_CALL_RADIUS.town,
    xpReward: 0,
    loot: [],
  },

  rat_pack_raider: {
    id: "rat_pack_raider",
    name: "Pack Rat",
    level: 2,
    maxHp: 60,
    baseDamageMin: 3,
    baseDamageMax: 6,
    model: "rat_small",
    tags: ["beast", "critter", "rat_pack"],
    behavior: "aggressive",
    groupId: "rat_pack",
    canCallHelp: true,
    socialRange: 12,
    xpReward: 12,
    loot: [
      {
        itemId: "rat_tail",
        chance: 0.7,
        minQty: 1,
        maxQty: 2,
      },
    ],
  },

  bandit_caster: {
    id: "bandit_caster",
    name: "Blackrock Warlock",
    level: 8,
    maxHp: 160,
    baseDamageMin: 6,
    baseDamageMax: 10,
    model: "human_bandit_caster",
    tags: ["humanoid", "bandit", "aggressive"],
    behavior: "aggressive",
    groupId: "blackrock_bandits",
    canCallHelp: true,
    canGate: true,
    socialRange: 18,
    xpReward: 45,
    loot: [],
  },
};

// live registry (DB + defaults merged)
let npcPrototypes: Record<string, NpcPrototype> = {
  ...DEFAULT_NPC_PROTOTYPES,
};

/**
 * Merge DB-provided prototypes on top of defaults.
 *
 * DB wins for overlapping IDs, but defaults still exist for dev-only IDs
 * like "coward_rat".
 */
export function setNpcPrototypes(list: NpcPrototype[]): void {
  const bag: Record<string, NpcPrototype> = { ...DEFAULT_NPC_PROTOTYPES };
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
