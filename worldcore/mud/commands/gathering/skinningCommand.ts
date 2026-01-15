// worldcore/mud/commands/gathering/skinningCommand.ts

import { isDeadEntity } from "../../../combat/entityCombat";
import { getNpcPrototype } from "../../../npc/NpcTypes";

import { addItemToBags } from "../../../items/InventoryHelpers";
import { getItemTemplate } from "../../../items/ItemCatalog";

import { applyFallbackSkinLoot } from "../../actions/MudWorldActions";
import { getSkinLootService } from "../../../combat/SkinLootService";

import { applyProgressionForEvent } from "../../MudProgressionHooks";
import { applyProgressionEvent } from "../../../progression/ProgressionCore";
import type { GatheringKind } from "../../../progression/ProgressEvents";

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

function describeItem(itemId: string, qty: number): string {
  const tpl = getItemTemplate(itemId);
  const name = tpl?.name ?? itemId;
  return qty === 1 ? name : `${qty}x ${name}`;
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
    const corpses = ents.filter(
      (e) =>
        (e?.type === "npc" || e?.type === "mob" || e?.type === "creature") &&
        isDeadEntity(e)
    );
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

  const protoId = String(tAny.protoId ?? tAny.npcProtoId ?? tAny.templateId ?? "");
  if (!protoId) return "[skinning] That corpse has no known prototype.";

  const proto = getNpcPrototype(protoId);
  const tags: string[] = Array.isArray(proto?.tags) ? proto!.tags.slice() : [];

  // --- progression hooks (quests/titles/etc) ---
  try {
    const gatheringKind: GatheringKind = "skinning";

    // Internal counters/flags.
    applyProgressionEvent(char, {
      kind: "harvest",
      nodeProtoId: protoId,
      gatheringKind,
      amount: 1,
    } as any);

    // MUD-side snippets (quests/titles hooks).
    await applyProgressionForEvent(ctx, char, "harvests", protoId);
  } catch {
    // best-effort; skinning should never crash from progression glue
  }

  // Prefer DB profiles.
  let drops: Array<{ itemId: string; minQty: number; maxQty: number; chance: number }> = [];
  try {
    const entries = await getSkinLootService().getEntries(protoId, tags);
    drops = entries.map((e) => ({
      itemId: e.itemId,
      minQty: e.minQty,
      maxQty: e.maxQty,
      chance: e.chance,
    }));
  } catch {
    drops = [];
  }

  // Fallback safety net (beast/critter → hide_scraps).
  if (drops.length === 0) {
    const fb = applyFallbackSkinLoot(protoId);
    if (!fb) return "[skinning] You find nothing worth harvesting.";
    drops = [{ itemId: fb.itemId, minQty: fb.minQty, maxQty: fb.maxQty, chance: 1 }];
  }

  const lootLines: string[] = [];
  let anyRolled = false;

  for (const d of drops) {
    const chance = Number.isFinite(d.chance) ? d.chance : 1;
    if (chance < 1 && Math.random() > chance) continue;

    const qty = rollInt(d.minQty, d.maxQty);
    if (qty <= 0) continue;

    anyRolled = true;

    const tpl = getItemTemplate(d.itemId);
    if (!tpl) continue;

    const maxStack = tpl.maxStack ?? 1;
    const leftover = addItemToBags(char.inventory, d.itemId, qty, maxStack);
    const added = qty - leftover;

    if (added > 0) lootLines.push(describeItem(d.itemId, added));

    // Overflow mail (best-effort)
    if (leftover > 0 && ctx.mail && ctx.session?.identity?.userId) {
      try {
        await ctx.mail.sendSystemMail(
          ctx.session.identity.userId,
          "account",
          "Overflow skinning loot",
          `Your bags were full while skinning ${target.name}. Extra items were delivered to your mailbox.`,
          [{ itemId: d.itemId, qty: leftover }]
        );
        lootLines.push(describeItem(d.itemId, leftover) + " (via mail)");
      } catch {
        // ignore mail failures
      }
    }
  }

  // Mark corpse as skinned even if bags were full — the action is consumed.
  tAny.skinned = true;

  // Notify room listeners (optional: visual “skinned” indicator)
  try {
    const room = ctx.rooms?.get?.(roomId);
    room?.broadcast?.("entity_update", { id: tAny.id, skinned: true });
  } catch {
    // ignore
  }

  // Persist inventory/progression changes
  try {
    ctx.session.character = char;
    await ctx.characters?.saveCharacter?.(char);
  } catch {
    // non-fatal
  }

  if (!anyRolled) return "[skinning] You find nothing worth harvesting.";
  if (lootLines.length === 0) return "[skinning] Your bags are full.";

  return `[skinning] You skin ${target.name}. You gather ${lootLines.join(", ")}.`;
}
