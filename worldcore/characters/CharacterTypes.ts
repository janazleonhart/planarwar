//worldcore/characters/CharacterTypes.ts

import { SimpleTask, QuestStateMap } from "../mud/MudProgression";

import type { GatheringKind } from "../progression/ProgressEvents"
import type { GatheringStats } from "../progression/ProgressEvents"



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
  // future-safe extras:
  [k: string]: any;
}

export interface ItemStack {
  itemId: string;     // string for now (later: canonical item db id)
  qty: number;        // stack count
  meta?: JsonObject;  // rolled stats, bound flags, etc.
}

export interface Bag {
  bagId: string;                 // stable bag identifier
  size: number;                  // slot count
  slots: Array<ItemStack | null>;
}

export interface InventoryState {
  bags: Bag[];
  currency?: Record<string, number>; // e.g. { gold: 0, gems: 0 }
  [k: string]: any;
}

export type EquipmentState = Record<string, ItemStack | null>; // slot -> stack

export interface SpellKnown {
  rank: number;
  learnedAt: number; // unix ms
}

export interface SpellbookState {
  known: Record<string, SpellKnown>; // spellId -> details
  cooldowns?: Record<string, number>; // spellId -> unix ms when ready
  [k: string]: any;
}

export type AbilitiesState = Record<string, any>;

export interface ProgressionState {
  aa?: Record<string, any>;
  rebirth?: Record<string, any>;
  seeds?: Record<string, any>;
  [k: string]: any;

  // v1.5 counters & state
  kills?: Record<string, number>;
  harvests?: Record<string, number>;
  actions?: Record<string, number>;
  tasks?: SimpleTask[];
  quests?: QuestStateMap;

  // NEW v2 progression
  collects?: Record<string, number>;                // itemId -> count
  flags?: Record<string, boolean | number | string>; // story / quest / misc
  exploration?: Record<string, number>;             // regionId -> visits
  gathering?: Partial<Record<GatheringKind, GatheringStats>>; // per-skill
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

  level: number;
  xp: number;

  pos_x: number;
  pos_y: number;
  pos_z: number;

  last_region_id: string | null;
  appearance_tag: string | null;

  // v1.5 blobs
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
  recentCrimeUntil?: number;
  recentCrimeSeverity?: "minor" | "severe";

  level: number;
  xp: number;

  posX: number;
  posY: number;
  posZ: number;

  lastRegionId: string | null;
  appearanceTag: string | null;

  // v1.5 typed blobs
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
}

// Lightweight DTO for listing on the web console
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

// Input from web-backend when creating a new character
export interface CreateCharacterInput {
  userId: string;
  shardId: string;
  name: string;
  classId: string;
}

// -----------------------------
// Defaults
// -----------------------------
export function defaultAttributes(): Attributes {
  return { str: 10, agi: 10, int: 10, sta: 10, wis: 10, cha: 10 };
}

export function defaultInventory(): InventoryState {
  // 1 starter bag with 12 slots
  return {
    bags: [{ bagId: "bag_0", size: 12, slots: Array(12).fill(null) }],
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
  return { known: {}, cooldowns: {} };
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
// Row → state
// -----------------------------
export function rowToCharacterState(row: CharacterRow): CharacterState {
  return {
    id: row.id,
    userId: row.user_id,
    shardId: row.shard_id,
    name: row.name,
    classId: row.class_id,

    level: row.level,
    xp: row.xp,

    posX: row.pos_x,
    posY: row.pos_y,
    posZ: row.pos_z,

    lastRegionId: row.last_region_id,
    appearanceTag: row.appearance_tag,

    // v1.5: accept existing JSONB, but hard-default if empty/null-ish
    attributes: (row.attributes as any) && Object.keys(row.attributes ?? {}).length
      ? (row.attributes as any)
      : defaultAttributes(),

    inventory: (row.inventory as any) && Object.keys(row.inventory ?? {}).length
      ? (row.inventory as any)
      : defaultInventory(),

    equipment: (row.equipment as any) && Object.keys(row.equipment ?? {}).length
      ? (row.equipment as any)
      : defaultEquipment(),

    spellbook: (row.spellbook as any) && Object.keys(row.spellbook ?? {}).length
      ? (row.spellbook as any)
      : defaultSpellbook(),

    abilities: (row.abilities as any) ?? defaultAbilities(),
    progression: (row.progression as any) ?? defaultProgression(),
    stateVersion: row.state_version ?? 1,

    createdAt: row.created_at,
    updatedAt: row.updated_at,

    guildId: row.guild_id ?? null,
  };
}

// State → summary for UI list
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
