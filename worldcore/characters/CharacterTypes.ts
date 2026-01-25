// worldcore/characters/CharacterTypes.ts

import type { SimpleTask, QuestStateMap } from "../mud/MudProgression";
import type { GatheringKind, GatheringStats } from "../progression/ProgressEvents";

// -----------------------------
// v1.5 JSONB scaffolding types
// -----------------------------
export type JsonObject = Record<string, any>;

export interface Attributes {
  str: number;
  agi: number;
  int: number;
  sta: number;
  wis: number;
  cha: number;
  [k: string]: any;
}

export interface ItemStack {
  itemId: string;
  qty: number;
  meta?: JsonObject;
}

export interface Bag {
  bagId: string;
  size: number;
  slots: Array<ItemStack | null>;
}

export interface InventoryState {
  bags: Bag[];
  currency?: Record<string, number>;
  [k: string]: any;
}

export type EquipmentState = Record<string, ItemStack | null>;

// -----------------------------
// Spellbook
// -----------------------------
export interface SpellKnown {
  rank: number;
  learnedAt: number; // unix ms
}

/**
 * Canonical spellbook shape used by runtime code.
 *
 * NOTE: `cooldowns` is optional to remain backward compatible with older tests
 * that construct spellbook as `{ known: {} }`.
 */
export interface SpellbookState {
  known: Record<string, SpellKnown>;
  cooldowns?: Record<string, { readyAt: number }>;
[k: string]: any;
}

// -----------------------------
// Rewards (mailbox overflow / deferred delivery)
// -----------------------------
export interface PendingRewardItem {
  itemId: string;
  qty: number;
  meta?: JsonObject;
}

export interface PendingRewardEntry {
  id?: string;
  createdAt?: number; // unix ms
  reason?: string;
  items: PendingRewardItem[];
  xp?: number;
  gold?: number;
  deliveredAt?: number; // unix ms
  [k: string]: any;
}

// -----------------------------
// Compatibility helpers (used by tests/tools)
// -----------------------------
export type ResistSchoolId =
  | "arcane"
  | "fire"
  | "frost"
  | "shadow"
  | "holy"
  | "nature";

export type ResistState = Record<ResistSchoolId, number>;
export function defaultResist(): ResistState {
  return {
    arcane: 0,
    fire: 0,
    frost: 0,
    shadow: 0,
    holy: 0,
    nature: 0,
  };
}

export type ResourcesState = Record<string, any>;
export function defaultResources(): ResourcesState {
  return {
    hp: { cur: 100, max: 100 },
    mana: { cur: 50, max: 50 },
    stamina: { cur: 50, max: 50 },
  };
}

export type SkillsState = Record<string, number>;
export function defaultSkills(): SkillsState {
  return {};
}

export type AbilitiesState = Record<string, any>;

export interface ProgressionState {
  aa?: Record<string, any>;
  rebirth?: Record<string, any>;
  seeds?: Record<string, any>;
  [k: string]: any;

  kills?: Record<string, number>;
  harvests?: Record<string, number>;
  actions?: Record<string, number>;
  tasks?: SimpleTask[];
  quests?: QuestStateMap;

  collects?: Record<string, number>;
  flags?: Record<string, any>;
  exploration?: Record<string, number>;

  gathering?: Partial<Record<GatheringKind, GatheringStats>>;
}

// -----------------------------
// Raw DB row as it comes back from Postgres
// -----------------------------
export interface CharacterRow {
  id: string;
  user_id: string;
  shard_id: string;
  name: string;
  class_id: string;
  race_id?: string | null;

  level: number;
  xp: number;

  pos_x: number;
  pos_y: number;
  pos_z: number;

  last_region_id: string | null;
  appearance_tag: string | null;

  attributes: JsonObject;
  inventory: JsonObject;
  equipment: JsonObject;
  spellbook: JsonObject;
  abilities: JsonObject;
  progression: JsonObject;

  state_version: number;

  created_at: Date;
  updated_at: Date;

  guild_id: string | null;
}

// -----------------------------
// Full server-side state
// -----------------------------
export interface CharacterState {
  id: string;
  userId: string;
  shardId: string;
  name: string;
  classId: string;
  raceId?: string;

  // Crime / law heat
  recentCrimeUntil?: number;
  recentCrimeSeverity?: "minor" | "severe";

  level: number;
  xp: number;

  posX: number;
  posY: number;
  posZ: number;

  lastRegionId: string | null;
  appearanceTag: string | null;

  attributes: Attributes;
  inventory: InventoryState;
  equipment: EquipmentState;

  spellbook: SpellbookState;
  abilities: AbilitiesState;
  progression: ProgressionState;

  stateVersion: number;

  createdAt: Date;
  updatedAt: Date;

  guildId?: string | null;

  // Optional deferred rewards (some systems persist this elsewhere; keep optional)
  pendingRewards?: PendingRewardEntry[];
}

export interface CharacterSummary {
  id: string;
  shardId: string;
  name: string;
  classId: string;
  level: number;
  xp: number;
  lastRegionId: string | null;
  appearanceTag: string | null;
}

export interface CreateCharacterInput {
  userId: string;
  shardId: string;
  name: string;
  classId: string;
  raceId?: string;
}

// -----------------------------
// Defaults
// -----------------------------
export function defaultAttributes(): Attributes {
  return { str: 10, agi: 10, int: 10, sta: 10, wis: 10, cha: 10 };
}

export function defaultInventory(): InventoryState {
  return {
    bags: [
      {
        bagId: "bag_0",
        size: 12,
        slots: Array(12).fill(null),
      },
    ],
    currency: { gold: 0 },
  };
}

export function defaultEquipment(): EquipmentState {
  return {
    head: null,
    chest: null,
    legs: null,
    feet: null,
    hands: null,
    mainhand: null,
    offhand: null,
    ring1: null,
    ring2: null,
    neck: null,
  };
}

export function defaultSpellbook(): SpellbookState {
  return {
    known: {},
    cooldowns: {},
  };
}

export function defaultAbilities(): AbilitiesState {
  return {};
}

export function defaultProgression(): ProgressionState {
  return {
    seeds: {},
    kills: {},
    harvests: {},
    actions: {},
    tasks: [],
    quests: {},
    collects: {},
    flags: {},
    exploration: {},
    gathering: {},
  };
}

// -----------------------------
// Normalizers
// -----------------------------
function normalizeSpellbook(raw: any): SpellbookState {
  // Legacy: [] or ["spell_a","spell_b"]
  if (Array.isArray(raw)) {
    const known: Record<string, SpellKnown> = {};
    for (const v of raw) {
      const spellId = typeof v === "string" ? v : null;
      if (!spellId) continue;
      known[spellId] = { rank: 1, learnedAt: 0 };
    }
    return { known, cooldowns: {} };
  }

  if (raw && typeof raw === "object") {
    const known =
      raw.known && typeof raw.known === "object" ? (raw.known as Record<string, SpellKnown>) : {};

    // Cooldowns have had two historical shapes:
    //  - Record<string, number> (readyAt millis)
    //  - Record<string, { readyAt: number }>
    const cooldownsOut: Record<string, { readyAt: number }> = {};
    const cdRaw = raw.cooldowns && typeof raw.cooldowns === "object" ? (raw.cooldowns as any) : null;
    if (cdRaw) {
      for (const [k, v] of Object.entries(cdRaw)) {
        if (!k) continue;
        if (typeof v === "number" && Number.isFinite(v)) {
          cooldownsOut[k] = { readyAt: v };
        } else if (v && typeof v === "object" && typeof (v as any).readyAt === "number") {
          cooldownsOut[k] = { readyAt: (v as any).readyAt };
        }
      }
    }

    return { known, cooldowns: cooldownsOut };
  }

  // default
  return { known: {}, cooldowns: {} };
}

// -----------------------------
// Crime helpers
// -----------------------------
export function hasActiveCrimeHeat(
  char: CharacterState,
  now: number = Date.now(),
): boolean {
  return !!char.recentCrimeUntil && char.recentCrimeUntil > now;
}

export function getCrimeHeatLabel(
  char: CharacterState,
  now: number = Date.now(),
): "none" | "minor" | "severe" {
  if (!hasActiveCrimeHeat(char, now)) return "none";
  return char.recentCrimeSeverity ?? "minor";
}

// -----------------------------
// Row → state
// -----------------------------
export function rowToCharacterState(row: CharacterRow): CharacterState {
  const attrs =
    row.attributes && Object.keys(row.attributes ?? {}).length
      ? (row.attributes as any)
      : defaultAttributes();

  const inv =
    row.inventory && Object.keys(row.inventory ?? {}).length
      ? (row.inventory as any)
      : defaultInventory();

  const equip =
    row.equipment && Object.keys(row.equipment ?? {}).length
      ? (row.equipment as any)
      : defaultEquipment();

  return {
    id: row.id,
    userId: row.user_id,
    shardId: row.shard_id,
    name: row.name,
    classId: row.class_id,
    raceId: row.race_id ?? undefined,

    level: row.level,
    xp: row.xp,

    posX: row.pos_x,
    posY: row.pos_y,
    posZ: row.pos_z,

    lastRegionId: row.last_region_id,
    appearanceTag: row.appearance_tag,

    attributes: attrs,
    inventory: inv,
    equipment: equip,

    spellbook: normalizeSpellbook(row.spellbook as any),

    abilities: ((row.abilities as any) ?? defaultAbilities()) as any,
    progression: ((row.progression as any) ?? defaultProgression()) as any,

    stateVersion: row.state_version ?? 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    guildId: row.guild_id ?? null,
  };
}

export function toCharacterSummary(state: CharacterState): CharacterSummary {
  return {
    id: state.id,
    shardId: state.shardId,
    name: state.name,
    classId: state.classId,
    level: state.level,
    xp: state.xp,
    lastRegionId: state.lastRegionId,
    appearanceTag: state.appearanceTag,
  };
}
