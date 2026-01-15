//worldcore/mud/commands/craftCommand.ts
//
// Tradeskills v1 – Craft command
// DB-backed recipes + optional station enforcement.
//
// IMPORTANT DESIGN RULE (v1):
// - Non-portable crafting requires being near the correct station entity.
// - Stations are seeded only inside towns/player-cities right now, so "near station"
//   is a stronger and less brittle check than trying to infer "town-ness" from room tags.

import { addItemToBags } from "../../items/InventoryHelpers";
import { listAllRecipes as listStaticRecipes } from "../../tradeskills/RecipeCatalog";
import { getTradeRecipeService } from "../../tradeskills/TradeRecipeService";
import {
  recordActionProgress,
  updateTasksFromProgress,
  updateQuestsFromProgress,
} from "../MudProgression";
import { canConsumeRecipe, consumeRecipe } from "../../items/inventoryConsume";

function stationGateEnabled(): boolean {
  return process.env.PW_CRAFT_STATIONS_REQUIRED === "1";
}

/**
 * Portable stations are allowed outside towns/player-cities.
 * v0 policy: portable stations do NOT require a world entity to exist yet.
 * (Later: spawn station_campfire via player action, then require proximity.)
 */
const PORTABLE_STATIONS = new Set<string>(["campfire"]);

function safeLower(x: any): string {
  return String(x ?? "").toLowerCase();
}

function normalizeKey(x: any): string {
  // "Alchemy Table" -> "alchemy_table"
  return safeLower(x)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getCurrentRoomId(ctx: any, char: any): string | null {
  // Preferred: the player’s “body” entity owns the authoritative roomId.
  const sessId = ctx?.session?.id;
  const entities = ctx?.entities;

  if (sessId && entities && typeof entities.getEntityByOwner === "function") {
    const selfEnt = entities.getEntityByOwner(sessId);
    const rid = selfEnt?.roomId;
    if (rid) return String(rid);
  }

  // Fallbacks: character state (some systems store it here)
  return (
    char?.roomId ??
    char?.position?.roomId ??
    char?.state?.roomId ??
    char?.location?.roomId ??
    ctx?.session?.roomId ??
    ctx?.session?.state?.roomId ??
    null
  );
}

function getRoomTags(ctx: any, roomId: string): string[] {
  const rooms = ctx?.rooms;
  if (!rooms || typeof rooms.getRoom !== "function") return [];
  const room = rooms.getRoom(roomId);
  const tags = room?.tags ?? [];
  return Array.isArray(tags) ? tags.map((t: any) => String(t)) : [];
}

function listRoomEntities(ctx: any, roomId: string): any[] {
  const entities = ctx?.entities;

  // EntityManager.ts (current) exposes getEntitiesInRoom(roomId)
  const fn =
    entities?.getEntitiesInRoom ??
    entities?.listRoomEntities ??
    entities?.listRoom ??
    entities?.getRoomEntities ??
    entities?.entitiesInRoom ??
    null;

  if (typeof fn !== "function") return [];
  const ents = fn.call(entities, roomId) ?? [];
  return Array.isArray(ents) ? ents : [];
}

/**
 * Best-effort "is station nearby?" check.
 * Conventions:
 * - station kind 'forge' => wants a station entity with tag/protoId 'station_forge'
 * - stations are hydrated as type='station'
 * - if tags/protoId aren't present, we fall back to matching by normalized name/model.
 */
function hasStationNearby(ctx: any, roomId: string, stationKind: string): boolean {
  const kind = normalizeKey(stationKind);
  if (!kind) return false;

  // Preferred: explicit world helper if it exists
  const w = ctx?.world;
  if (w && typeof w.hasCraftingStationNearby === "function") {
    return !!w.hasCraftingStationNearby(roomId, kind, ctx?.session);
  }
  if (w && typeof w.hasCraftingStation === "function") {
    return !!w.hasCraftingStation(roomId, kind);
  }

  // Room tag check: station_<kind>
  const roomTags = getRoomTags(ctx, roomId).map((t) => normalizeKey(t));
  if (roomTags.includes(`station_${kind}`)) return true;

  // Entity scan
  const ents = listRoomEntities(ctx, roomId);
  const want = `station_${kind}`;
  const wantAlt = `craft_station_${kind}`;

  for (const e of ents) {
    const type = safeLower(e?.type);
    if (type !== "station") continue;

    // 1) tag-based (preferred)
    const tags: string[] = e?.tags ?? e?.proto?.tags ?? [];
    if (Array.isArray(tags)) {
      const lowered = tags.map((t) => normalizeKey(t));
      if (lowered.includes(normalizeKey(want)) || lowered.includes(normalizeKey(wantAlt))) return true;
      if (lowered.includes(normalizeKey(want))) return true;
    }

    // 2) protoId/model if present
    const protoId = normalizeKey(e?.protoId ?? e?.proto?.id ?? "");
    if (protoId === normalizeKey(want)) return true;

    const model = normalizeKey(e?.model ?? "");
    if (model === normalizeKey(want)) return true;

    // 3) name fallback (what your nearby list shows reliably)
    const nameKey = normalizeKey(e?.name ?? "");
    if (nameKey === kind) return true; // "forge" matches
    // (no special-case needed; normalizeKey handles 'Alchemy Table' -> 'alchemy_table')
    //

    // Common station display names:
    //  - "Alchemy Table" -> alchemy_table
    //  - "Millstone" -> millstone
    if (nameKey === kind) return true;
  }

  return false;
}

function prettyStation(stationKind: string): string {
  const k = normalizeKey(stationKind);
  return k ? `station_${k}` : "station";
}

export async function handleCraftCommand(
  ctx: any,
  char: any,
  parts: string[],
): Promise<string> {
  if (!ctx.items) return "Item service is not available.";
  if (!ctx.characters) return "Character service is not available.";

  const recipeSvc = getTradeRecipeService();
  const sub = (parts[1] ?? "").toLowerCase();

  // craft / craft help / craft list
  if (!sub || sub === "help" || sub === "list") {
    const recipes = await recipeSvc.listAll();
    const list = recipes.length > 0 ? recipes : listStaticRecipes();

    if (list.length === 0) return "You do not know any crafting recipes yet.";

    let out = "Known recipes:\n";
    for (const r of list) {
      const station = (r as any).stationKind ?? null;
      const stationNote = station ? ` (requires: ${station})` : "";
      out += ` - ${r.id}: ${r.name} [${r.category}]${stationNote}\n`;
    }
    out += "Use: craft <id|name> [count]";
    return out.trimEnd();
  }

  // craft <id|name> [count]
  const token = sub;
  const countArg = parts[2];
  const count = countArg ? Math.max(1, Number(countArg) || 1) : 1;

  const recipe = await recipeSvc.findByIdOrName(token);
  if (!recipe) {
    return `You do not know any recipe matching '${token}'.\nUse 'craft list' to see available recipes.`;
  }

  // Optional station enforcement
  const station = (recipe as any).stationKind ?? null;
  if (station && stationGateEnabled()) {
    const sk = normalizeKey(station);

    // Portable stations: allow anywhere for v0 (no world entity required yet).
    if (!PORTABLE_STATIONS.has(sk)) {
      const roomId = getCurrentRoomId(ctx, char);
      if (!roomId) {
        return `This recipe requires '${station}', but your room/location is unknown.`;
      }

      // Primary gate: must be near the correct station.
      if (!hasStationNearby(ctx, roomId, sk)) {
        return `You must be near a '${prettyStation(sk)}' to craft '${recipe.name}'.`;
      }
    }
  }

  // Ensure all items exist in DB (inputs + outputs)
  for (const ing of recipe.inputs) {
    if (!ctx.items.get(ing.itemId)) {
      return `Recipe '${recipe.name}' requires unknown item '${ing.itemId}'. (Add it to DB first.)`;
    }
  }
  for (const out of recipe.outputs) {
    if (!ctx.items.get(out.itemId)) {
      return `Recipe '${recipe.name}' produces unknown item '${out.itemId}'. (Add it to DB first.)`;
    }
  }

  // 1) Check ingredients
  const check = canConsumeRecipe(char.inventory, recipe.inputs, count);
  if (!check.ok) {
    const def = ctx.items.get(check.itemId);
    const name = def?.name ?? check.itemId;
    return `You need ${check.need}x ${name}, but only have ${check.have}.`;
  }

  // 2) Consume ingredients
  if (!consumeRecipe(char.inventory, recipe.inputs, count)) {
    return "An internal error occurred while removing ingredients.";
  }

  // 3) Add outputs (mail overflow supported)
  let totalMade = 0;
  let totalMailed = 0;

  for (const out of recipe.outputs) {
    const def = ctx.items.get(out.itemId)!;
    const maxStack = def.maxStack ?? 1;

    const totalToMake = out.qty * count;
    let remaining = totalToMake;

    const leftover = addItemToBags(char.inventory, def.id, remaining, maxStack);
    const added = remaining - leftover;
    totalMade += added;
    remaining = leftover;

    if (remaining > 0 && ctx.mail && ctx.session.identity) {
      await ctx.mail.sendSystemMail(
        ctx.session.identity.userId,
        "account",
        "Crafting overflow",
        `You crafted ${totalToMake}x ${def.name}, but some could not fit in your bags.`,
        [{ itemId: def.id, qty: remaining }],
      );
      totalMailed += remaining;
    }
  }

  // 4) Progression hooks
  recordActionProgress(char, `craft_${recipe.category}`);
  recordActionProgress(char, "craft_any");
  updateTasksFromProgress(char);
  updateQuestsFromProgress(char);

  await ctx.characters.saveCharacter(char);

  let msg = `You craft ${count}x '${recipe.name}'.`;
  if (totalMade > 0) msg += ` ${totalMade} item(s) went into your bags.`;
  if (totalMailed > 0) msg += ` ${totalMailed} item(s) were sent to your mailbox.`;
  return msg;
}
