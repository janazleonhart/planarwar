// worldcore/characters/Stats.ts

import { Attributes, CharacterState } from "./CharacterTypes";
import { getItemTemplate } from "../items/ItemCatalog";
import { TITLES } from "./TitleTypes";

import type { ItemService } from "../items/ItemService";

function cloneAttributes(attrs: Attributes): Attributes {
  return {
    str: attrs.str,
    agi: attrs.agi,
    int: attrs.int,
    sta: attrs.sta,
    wis: attrs.wis,
    cha: attrs.cha,
  };
}

function mergeItemStatsIntoAttributes(
  target: Attributes,
  stats: Record<string, any> | undefined
): void {
  if (!stats) return;

  const keys: (keyof Attributes)[] = ["str", "agi", "int", "sta", "wis", "cha"];

  for (const key of keys) {
    const raw = (stats as any)[key];
    if (raw === undefined || raw === null) continue;

    const delta = Number(raw);
    if (!Number.isFinite(delta) || delta === 0) continue;

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore – numeric field
    target[key] = (target[key] ?? 0) + delta;
  }
}

function applyTitleBonuses(
  effective: Attributes,
  char: CharacterState
): void {
  const prog: any = char.progression || {};
  const titles = prog.titles || {};
  const activeId: string | null = titles.active ?? null;

  if (!activeId) return;

  const def = TITLES[activeId];
  if (!def || !def.bonuses || !def.bonuses.attributes) return;

  // Reuse same logic as item stats: this can apply STR/AGI/STA/etc bonuses.
  mergeItemStatsIntoAttributes(
    effective,
    def.bonuses.attributes as Record<string, any>
  );
}

/**
 * Compute effective attributes (base + gear bonuses).
 * Non-destructive: does not modify char.attributes.
 */
export function computeEffectiveAttributes(
  char: CharacterState,
  itemService?: ItemService
): Attributes {
  const effective = cloneAttributes(char.attributes);
  const equipment = char.equipment || {};

  for (const slot of Object.keys(equipment)) {
    const stack: any = (equipment as any)[slot];
    if (!stack || !stack.itemId) continue;

    const itemId: string = stack.itemId;

    let stats: Record<string, any> | undefined;

    // 1) Try DB-backed item
    if (itemService) {
      const def = itemService.get(itemId);
      if (def && def.stats) {
        stats = def.stats;
      }
    }

    // 2) Fallback to static catalog (starter gear)
    if (!stats) {
      const tmpl = getItemTemplate(itemId);
      if (tmpl && tmpl.stats) {
        stats = tmpl.stats;
      }
    }

    mergeItemStatsIntoAttributes(effective, stats);
  }

  // After gear, apply active title bonuses
  applyTitleBonuses(effective, char);

  return effective;
}
