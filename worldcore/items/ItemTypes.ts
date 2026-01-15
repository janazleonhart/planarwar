// worldcore/items/ItemTypes.ts

import { StaffRole } from "../auth/StaffRoles";

export interface ItemTemplate {
  id: string;
  name: string;

  // Equipment / usage slot. Gear uses "head", "chest", "mainhand" etc,
  // non-gear can use any tag (e.g. "material", "food", etc).
  slot: string;

  // Stack size: defaults to 1.
  maxStack?: number;
  baseValue?: number;

  // Optional gameplay stats (for gear).
  stats?: Record<string, number>; // e.g. { str: 2, sta: 1 }

  // Optional flavor / metadata – safe to omit for simple items.
  category?: string;      // "gear", "material", "food", etc.
  description?: string;   // tooltip text
  rarity?: ItemRarity;    // "common", "rare", etc.

  // Optional free-form tags (safe for local/dev catalogs; DB uses category/specialization).
  tags?: string[];
}

export const EQUIP_SLOTS = [
  "head",
  "chest",
  "legs",
  "feet",
  "hands",
  "mainhand",
  "offhand",
  "ring1",
  "ring2",
  "neck",
] as const;

export type EquipSlot = (typeof EQUIP_SLOTS)[number];

export type ItemRarity =
  | "common"
  | "uncommon"
  | "rare"
  | "legendary"
  | "mythic"
  | string;

export interface ItemDefinition {
  id: string;                // "ore_iron_hematite"
  itemKey: string;           // "ore_iron"
  name: string;
  description: string;
  rarity: ItemRarity;
  slot: EquipSlot;
  category?: string | null;          // "ore", "herb", "mana", "food", "wood", "stone", "fish", "gear", ...
  specializationId?: string | null;  // e.g. "spec_ore_iron"
  iconId?: string | null;

  maxStack: number;                  // 1 for weapons, 99+ for resources

  flags: Record<string, any>;        // bind flags, quest flags, etc.
  stats: Record<string, any>;        // future: damage, armor, bonuses, etc.
  baseValue: number | null;

  isDevOnly: boolean;
  grantMinRole: StaffRole;

  createdAt: Date;
  updatedAt: Date;
}

// Row coming back from Postgres
export interface ItemRow {
  id: string;
  item_key: string;
  name: string;
  description: string;
  rarity: string;
  slot: EquipSlot;
  category: string | null;
  specialization_id: string | null;
  icon_id: string | null;
  max_stack: number;
  flags: any;
  stats: any;
  baseValue: number;
  is_dev_only: boolean;
  grant_min_role: string; // 'player' | 'guide' | 'gm' | 'dev' | 'owner'
  created_at: Date;
  updated_at: Date;
}

export function rowToItemDefinition(row: ItemRow): ItemDefinition {
  return {
    id: row.id,
    itemKey: row.item_key,
    name: row.name,
    description: row.description,
    rarity: row.rarity,
    slot: row.slot,
    category: row.category,
    specializationId: row.specialization_id,
    iconId: row.icon_id,
    maxStack: row.max_stack ?? 9999,
    flags: (row.flags as any) || {},
    stats: (row.stats as any) || {},
    baseValue: row.baseValue,
    isDevOnly: row.is_dev_only ?? false,
    grantMinRole: (row.grant_min_role as StaffRole) ?? "player",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
