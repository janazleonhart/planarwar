// worldcore/pets/PetGear.ts
//
// Pet Engine v1.4: Pet gear shares the SAME item definitions as players.
// Items are DB-backed (items.stats JSONB) with a static catalog fallback.
//
// This module maps item stats to a small, conservative set of pet combat knobs:
// - maxHp adjustments
// - outgoing damage multiplier adjustments
// - proc payload discovery (for combat hooks)
//
// Important: this is intentionally *simple*; we can replace it later with a
// full "pets have attributes + derived stats" pipeline without changing
// equipment persistence or item data.

import { getItemTemplate } from "../items/ItemCatalog";
import type { PetRoleId } from "./PetProfiles";

export type PetGearBonuses = {
  hpFlat: number;
  hpPct: number; // 0.10 => +10%
  dmgPct: number; // 0.10 => +10%
};

export type ItemProcDef = {
  trigger?: "on_hit" | "on_being_hit";
  chance?: number; // 0..1
  icdMs?: number;

  // Added v1.5: proc sources (for per-slot ICD buckets + debugging)
  slot?: string;
  itemId?: string;

  damage?: number;
  spellId?: string;
  applyTo?: "target" | "self" | "owner";
  allowProcChain?: boolean;

  name?: string;
  id?: string;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function getStatsForItem(itemId: string, itemService: any): Record<string, any> | undefined {
  // 1) DB-backed item service (preferred)
  try {
    if (itemService && typeof itemService.get === "function") {
      const def = itemService.get(itemId);
      if (def && typeof def === "object" && (def as any).stats) {
        return (def as any).stats as Record<string, any>;
      }
    }
  } catch {
    // ignore
  }

  // 2) Static catalog fallback
  try {
    const tpl = getItemTemplate(itemId);
    if (tpl && (tpl as any).stats) return (tpl as any).stats as Record<string, any>;
  } catch {
    // ignore
  }

  return undefined;
}

function getRolePrimaryKeys(role: PetRoleId): Array<"str" | "agi" | "int" | "wis" | "cha"> {
  switch (role) {
    case "pet_tank":
      return ["str"]; // tank damage is low anyway; keep it modest
    case "pet_heal":
      return ["wis", "int"];
    case "pet_utility":
      return ["int", "cha"];
    case "pet_dps":
    default:
      return ["str", "agi"];
  }
}

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function resolveEquippedItemId(stack: any): string | null {
  if (!stack) return null;
  if (typeof stack === "string") {
    const s = stack.trim();
    return s ? s : null;
  }
  if (typeof stack === "object") {
    const v = (stack as any).itemId ?? (stack as any).id;
    if (typeof v === "string") {
      const s = v.trim();
      return s ? s : null;
    }
  }
  return null;
}

// Conservative mapping constants.
// These are *not* meant to be final tuning; they're here so pet gear immediately
// matters without blowing up balance.
const STA_TO_HP = 6; // +6 max HP per STA
const PRIMARY_TO_DMG_PCT = 0.008; // 0.8% per primary stat point

export function computePetGearBonuses(pet: any, itemService: any): PetGearBonuses {
  const equip: any = (pet as any)?.equipment || {};
  const role: PetRoleId = String((pet as any)?.petRole ?? "pet_dps") as PetRoleId;

  let hpFlat = 0;
  let hpPct = 0;
  let dmgPct = 0;

  const primaryKeys = getRolePrimaryKeys(role);

  for (const slot of Object.keys(equip)) {
    const stack: any = equip[slot];
    const itemId = resolveEquippedItemId(stack);
    if (!itemId) continue;
    const stats = getStatsForItem(itemId, itemService);
    if (!stats) continue;

    // Explicit pet knobs (best)
    hpFlat += num((stats as any).petHpFlat);
    hpPct += num((stats as any).petHpPct);
    dmgPct += num((stats as any).petDmgPct);

    // Attribute mapping (fallback) — shared with player gear
    const sta = num((stats as any).sta);
    if (sta) hpFlat += sta * STA_TO_HP;

    let primarySum = 0;
    for (const k of primaryKeys) primarySum += num((stats as any)[k]);
    if (primarySum) dmgPct += primarySum * PRIMARY_TO_DMG_PCT;
  }

  return {
    hpFlat: Math.floor(hpFlat),
    hpPct: clamp(hpPct, -0.5, 3),
    dmgPct: clamp(dmgPct, -0.5, 3),
  };
}

export function applyPetGearToVitals(pet: any, itemService: any): void {
  const baseMax = typeof pet?.maxHp === "number" ? pet.maxHp : typeof pet?.hp === "number" ? pet.hp : 1;
  const b = computePetGearBonuses(pet, itemService);

  let nextMax = baseMax;
  if (b.hpPct) nextMax = Math.max(1, Math.round(nextMax * (1 + b.hpPct)));
  if (b.hpFlat) nextMax = Math.max(1, nextMax + b.hpFlat);

  pet.maxHp = nextMax;
  if (typeof pet.hp !== "number") pet.hp = nextMax;
  else pet.hp = Math.min(pet.hp, nextMax);

  // Cache bonuses so combat hooks can use them without re-walking gear constantly.
  (pet as any)._pwPetGearBonuses = b;
}

export function getPetGearDamageMult(pet: any): number {
  const b: PetGearBonuses | undefined = (pet as any)?._pwPetGearBonuses;
  if (!b) return 1;
  const mult = 1 + (b.dmgPct ?? 0);
  return clamp(mult, 0.1, 10);
}

export function collectItemProcsFromGear(pet: any, itemService: any): ItemProcDef[] {
  const equip: any = (pet as any)?.equipment || {};
  const out: ItemProcDef[] = [];

  for (const slot of Object.keys(equip)) {
    const stack: any = equip[slot];
    const itemId = resolveEquippedItemId(stack);
    if (!itemId) continue;
    const stats = getStatsForItem(itemId, itemService);
    if (!stats) continue;

    const maybe = (stats as any).procs ?? (stats as any).proc ?? (stats as any).procOnHit;
    if (!maybe) continue;

    if (Array.isArray(maybe)) {
      for (const p of maybe) {
        if (p && typeof p === "object") out.push({ ...(p as any), slot: String(slot), itemId: itemId } as ItemProcDef);
      }
    } else if (typeof maybe === "object") {
      out.push({ ...(maybe as any), slot: String(slot), itemId: itemId } as ItemProcDef);
    }
  }

  return out;
}
