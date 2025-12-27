// worldcore/items/ItemDisplay.ts

import { ItemService } from "./ItemService";
import { getItemTemplate } from "./ItemCatalog";
import { ItemDefinition, ItemTemplate, ItemRarity } from "./ItemTypes";
import { Colors, ColorCode } from "../utils/colors";

/**
 * Resolve an itemId to a human-readable label, without color.
 *
 * Priority:
 *   1) DB-backed ItemService definition
 *   2) Static ItemCatalog template
 *   3) Raw id as fallback
 *
 * Examples:
 *   "Peacebloom [common herb]"
 *   "Copper Ore [uncommon ore]"
 */
export function formatItemLabel(
  itemService: ItemService | undefined,
  itemId: string
): string {
  if (!itemId) return "unknown";

  // 1) DB-backed item
  if (itemService) {
    const def = itemService.findByIdOrName(itemId);
    if (def) {
      return formatItemDefinition(def);
    }
  }

  // 2) Static template
  const tmpl = getItemTemplate(itemId);
  if (tmpl) {
    return formatItemTemplate(tmpl);
  }

  // 3) Raw id
  return itemId;
}

/**
 * Format a DB-backed item definition as a label.
 */
export function formatItemDefinition(def: ItemDefinition): string {
  const name = def.name ?? def.id;
  const rarity = def.rarity ?? "common";
  const category = def.category ?? "";
  if (category) {
    return `${name} [${rarity} ${category}]`;
  }
  return `${name} [${rarity}]`;
}

/**
 * Format a static ItemTemplate as a label.
 * (Some fields like rarity/category are optional on templates,
 *  so we peek via 'any' to avoid strict typing drama.)
 */
export function formatItemTemplate(tmpl: ItemTemplate): string {
  const anyT: any = tmpl;
  const name = tmpl.name ?? tmpl.id;
  const rarity: ItemRarity | string = anyT.rarity ?? "common";
  const category: string = anyT.category ?? "";
  if (category) {
    return `${name} [${rarity} ${category}]`;
  }
  return `${name} [${rarity}]`;
}

/**
 * Map item rarity to a console ANSI color code.
 * This doesn't apply the color; use your own colorize/ANSI pipe.
 */
export function getItemRarityColorCode(
  rarity: ItemRarity | string | undefined
): ColorCode {
  switch (rarity) {
    case "uncommon":
      return Colors.FgGreen;
    case "rare":
      return Colors.FgBlue;
    case "epic":
      return Colors.FgMagenta;
    case "legendary":
      return Colors.FgYellow;
    case "common":
    default:
      return Colors.FgWhite;
  }
}

/**
 * Tooltip descriptor for an item.
 * `label` is the same text as formatItemDefinition/Template.
 */
export interface ItemTooltip {
  label: string;
  rarity: ItemRarity | string;
  lines: string[];
}

/**
 * Build a simple multi-line tooltip for an item.
 * First line is the label, followed by description and stats (if any).
 */
export function getItemTooltip(
  itemService: ItemService | undefined,
  itemId: string
): ItemTooltip | null {
  if (!itemId) return null;

  // Prefer DB-backed item definitions
  if (itemService) {
    const def = itemService.findByIdOrName(itemId);
    if (def) {
      return buildTooltipFromDefinition(def);
    }
  }

  const tmpl = getItemTemplate(itemId);
  if (tmpl) {
    return buildTooltipFromTemplate(tmpl);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internal builders
// ---------------------------------------------------------------------------

function buildTooltipFromDefinition(def: ItemDefinition): ItemTooltip {
  const label = formatItemDefinition(def);
  const rarity: ItemRarity | string = def.rarity ?? "common";
  const lines: string[] = [];

  if (def.description) {
    lines.push(def.description);
  }

  // Stats
  const stats = def.stats || {};
  const statKeys = Object.keys(stats);
  if (statKeys.length > 0) {
    const parts: string[] = [];
    for (const key of statKeys) {
      const value = stats[key];
      if (value === 0 || value === null || value === undefined) continue;
      parts.push(`${key}+${value}`);
    }
    if (parts.length > 0) {
      lines.push(`Stats: ${parts.join(", ")}`);
    }
  }

  if (typeof def.maxStack === "number" && def.maxStack > 1) {
    lines.push(`Stack size: up to ${def.maxStack}`);
  }

  if (typeof (def as any).baseValue === "number") {
    lines.push(`Value: ${(def as any).baseValue} coin`);
  }

  return { label, rarity, lines };
}

function buildTooltipFromTemplate(tmpl: ItemTemplate): ItemTooltip {
  const label = formatItemTemplate(tmpl);
  const anyT: any = tmpl;
  const rarity: ItemRarity | string = anyT.rarity ?? "common";
  const lines: string[] = [];

  if (tmpl.description) {
    lines.push(tmpl.description);
  }

  const stats = anyT.stats || {};
  const statKeys = Object.keys(stats);
  if (statKeys.length > 0) {
    const parts: string[] = [];
    for (const key of statKeys) {
      const value = stats[key];
      if (value === 0 || value === null || value === undefined) continue;
      parts.push(`${key}+${value}`);
    }
    if (parts.length > 0) {
      lines.push(`Stats: ${parts.join(", ")}`);
    }
  }

  if (typeof tmpl.maxStack === "number" && tmpl.maxStack > 1) {
    lines.push(`Stack size: up to ${tmpl.maxStack}`);
  }

  if (typeof tmpl.baseValue === "number") {
    lines.push(`Value: ${tmpl.baseValue} coin`);
  }

  return { label, rarity, lines };
}
