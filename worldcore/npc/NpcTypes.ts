// worldcore/npc/NpcTypes.ts

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
  protoId: NpcId;      // identity – e.g. "coward_rat"
  templateId: NpcId;   // actual prototype key used
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

export function getGuardCallRadius(profile?: GuardProfile, override?: number): number | undefined {
  if (typeof override === "number") return override;
  if (!profile) return undefined;
  return DEFAULT_GUARD_CALL_RADIUS[profile];
}

// ---------------------------------------------------------------------------
// Hard-coded defaults (dev seed / fallback)
// ---------------------------------------------------------------------------

export const DEFAULT_NPC_PROTOTYPES: Record<string, NpcPrototype> = {
  training_dummy: {
    id: "training_dummy",
    name: "Training Dummy",
    level: 1,
    maxHp: 200,
    baseDamageMin: 0,
    baseDamageMax: 0,
    model: "training_dummy",
    tags: ["training", "non_hostile", "civilian"],
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
    // 👇 no more spawn-camping: town rat is now neutral
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
    maxHp: 200, // chunky for testing; tune later
    baseDamageMin: 1,
    baseDamageMax: 3,
    model: "rat_small",
    tags: ["beast", "critter", "coward_test"],
    behavior: "coward",
    groupId: "rat_pack",
    canCallHelp: true,
    socialRange: 10,
    xpReward: 10,
    loot: [
      { itemId: "rat_tail", chance: 0.7, minQty: 1, maxQty: 2 },
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
    loot: [{ itemId: "rat_tail", chance: 0.7, minQty: 1, maxQty: 2 }],
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
