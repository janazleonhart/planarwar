// worldcore/mud/commands/gathering/skinningCommand.ts

import type { Entity } from "../../../shared/Entity";

import { isDeadEntity } from "../../../combat/entityCombat";
import { getNpcPrototype } from "../../../npc/NpcTypes";

import { addItemToBags } from "../../../items/InventoryHelpers";
import { getItemTemplate } from "../../../items/ItemCatalog";

import { applyFallbackSkinLoot } from "../../actions/MudWorldActions";
import { getSkinLootService } from "../../../combat/SkinLootService";

function norm(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function rollInt(minQty: number, maxQty: number): number {
  const a = Math.max(0, Math.floor(minQty));
  const b = Math.max(0, Math.floor(maxQty));
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hi <= lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function getCurrentRoomId(ctx: any, char: any): string | null {
  const sessId = ctx?.session?.id;
  const entities = ctx?.entities;

  if (sessId && entities?.getEntityByOwner) {
    const selfEnt = entities.getEntityByOwner(sessId);
    if (selfEnt?.roomId) return String(selfEnt.roomId);
  }

  return (
    char?.roomId ??
    char?.position?.roomId ??
    char?.state?.roomId ??
    char?.location?.roomId ??
    ctx?.session?.roomId ??
    null
  );
}

function getRoomEntities(ctx: any, roomId: string): any[] {
  const entities = ctx?.entities;
  if (!entities) return [];
  if (typeof entities.getEntitiesInRoom === "function") {
    const r = entities.getEntitiesInRoom(roomId);
    return Array.isArray(r) ? r : [];
  }
  return [];
}

function resolveByHandleOrName(ents: any[], targetRaw: string): any | null {
  const t = targetRaw.trim();
  if (!t) return null;

  // Handle match (e.g., rat.1)
  const want = norm(t);
  for (const e of ents) {
    const handle = norm(e?.handle ?? "");
    if (handle && handle === want) return e;
  }

  // Name match (e.g., "Town Rat")
  const wantName = norm(t);
  for (const e of ents) {
    const name = norm(e?.name ?? "");
    if (name && name === wantName) return e;
  }

  // Number targeting based on visible order ("nearby" offering)
  const n = Number(t);
  if (Number.isFinite(n) && n >= 1) {
    // The nearby list includes multiple types; this command only considers dead NPCs.
    const corpses = ents.filter((e) => (e?.type === "npc" || e?.type === "mob" || e?.type === "creature") && isDeadEntity(e));
    return corpses[n - 1] ?? null;
  }

  return null;
}

export async function handleSkinningCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[]; world?: any }
): Promise<string> {
  const targetNameRaw = input.args.join(" ").trim();
  if (!targetNameRaw) return "Usage: skin <corpse> (e.g. 'skin rat.1' or 'skin 2')";

  if (!ctx.entities) return "There is nothing here to skin.";

  const roomId = getCurrentRoomId(ctx, char);
  if (!roomId) return "Your room/location is unknown.";

  const ents = getRoomEntities(ctx, roomId);
  const target: any = resolveByHandleOrName(ents, targetNameRaw);
  if (!target) return `There is no '${targetNameRaw}' here.`;

  // Only NPC corpses can be skinned.
  const type = String(target?.type ?? "");
  if (!(type === "npc" || type === "mob" || type === "creature")) {
    return "That can't be skinned.";
  }

  if (!isDeadEntity(target as any)) {
    return "That isn't a corpse yet. Try again after it's dead.";
  }

  const tAny = target as any;
  if (tAny.skinned) return "[skinning] That corpse has already been skinned.";

  const protoId = String(tAny.protoId ?? tAny.npcProtoId ?? "");
  if (!protoId) return "[skinning] That corpse has no known prototype.";

  const proto = getNpcPrototype(protoId);
  const tags: string[] = Array.isArray(proto?.tags) ? proto!.tags.slice() : [];

  // Prefer DB profiles.
  let drops: Array<{ itemId: string; minQty: number; maxQty: number; chance: number }> = [];
  try {
    const entries = await getSkinLootService().getEntries(protoId, tags);
    drops = entries.map((e) => ({ itemId: e.itemId, minQty: e.minQty, maxQty: e.maxQty, chance: e.chance }));
  } catch {
    drops = [];
  }

  // Fallback safety net (beast/critter → hide_scraps).
  if (drops.length === 0) {
    const fb = applyFallbackSkinLoot(protoId);
    if (!fb) return "[skinning] You find nothing worth harvesting.";
    drops = [{ itemId: fb.itemId, minQty: fb.minQty, maxQty: fb.maxQty, chance: 1 }];
  }

  let totalAdded = 0;
  let anyDropped = false;

  for (const d of drops) {
    const chance = Number.isFinite(d.chance) ? d.chance : 1;
    if (chance < 1 && Math.random() > chance) continue;

    const tpl = getItemTemplate(d.itemId);
    if (!tpl) continue;

    const qty = rollInt(d.minQty, d.maxQty);
    if (qty <= 0) continue;

    anyDropped = true;

    const maxStack = tpl.maxStack ?? 1;
    const leftover = addItemToBags(char.inventory, d.itemId, qty, maxStack);
    const added = qty - leftover;
    totalAdded += Math.max(0, added);
  }

  tAny.skinned = true;

  try {
    await ctx.characters?.saveCharacter?.(char);
  } catch {
    // non-fatal
  }

  if (!anyDropped) return "[skinning] You find nothing worth harvesting.";
  if (totalAdded <= 0) return "[skinning] Your bags are full.";

  return `[skinning] You skin ${target.name}. You gather ${totalAdded} item(s).`;
}
