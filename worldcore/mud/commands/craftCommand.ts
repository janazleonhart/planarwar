//worldcore/mud/commands/craftCommand.ts
//
// Tradeskills v1 – Craft command
// DB-backed recipes + optional station enforcement.
//
// IMPORTANT DESIGN RULE (v1):
// - Non-portable crafting requires being near the correct station entity.
// - Stations are seeded only inside towns/player-cities right now, so "near station"
//   is a stronger and less brittle check than trying to infer "town-ness" from room tags.

import { deliverItemsToBagsOrMail } from "../../loot/OverflowDelivery";
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

function cloneInventoryForSimulation(inv: any): any {
  // Minimal deep clone for bags/slots. We only simulate stack merges.
  if (!inv || !Array.isArray(inv.bags)) return JSON.parse(JSON.stringify(inv ?? {}));
  return {
    ...inv,
    bags: inv.bags.map((b: any) => {
      const slots = Array.isArray(b?.slots) ? b.slots : [];
      return {
        ...b,
        slots: slots.map((s: any) => (s ? { ...s } : null)),
      };
    }),
  };
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

  // If mail is unavailable, ensure outputs will fit before we consume ingredients.
  if (!ctx.mail) {
    const simInv = cloneInventoryForSimulation(char.inventory);
    const simCtx: any = { items: ctx.items }; // no mail on purpose

    const sim = await deliverItemsToBagsOrMail(simCtx, {
      inventory: simInv,
      items: recipe.outputs.map((o: any) => ({ itemId: o.itemId, qty: o.qty * count })),
      undeliveredPolicy: "keep",
    });

    const undelivered = sim.results.reduce((sum: number, r: any) => sum + (r.leftover ?? 0), 0);
    if (undelivered > 0) {
      return "Your bags are too full to receive the crafted items (and mailbox delivery is unavailable).";
    }
  }

  // 2) Consume ingredients
  if (!consumeRecipe(char.inventory, recipe.inputs, count)) {
    return "An internal error occurred while removing ingredients.";
  }

  // 3) Add outputs (bags first; overflow to mail when available)
  const deliver = await deliverItemsToBagsOrMail(ctx, {
    inventory: char.inventory,
    items: recipe.outputs.map((o: any) => ({ itemId: o.itemId, qty: o.qty * count })),

    ownerId: ctx.session?.identity?.userId,
    ownerKind: "account",

    sourceVerb: "crafting",
    sourceName: recipe.name,
    mailSubject: "Crafting overflow",
    mailBody: `Your bags were full while crafting '${recipe.name}'. Extra items were delivered to your mailbox.`,

    undeliveredPolicy: "keep",
  });

  const totalMade = deliver.totalAdded;
  const totalMailed = deliver.totalMailed;
  const totalUndelivered = deliver.results.reduce((sum: number, r: any) => sum + (r.leftover ?? 0), 0);

  // 4) Progression hooks
  recordActionProgress(char, `craft_${recipe.category}`);
  recordActionProgress(char, "craft_any");
  updateTasksFromProgress(char);
  updateQuestsFromProgress(char);

  await ctx.characters.saveCharacter(char);

  let msg = `You craft ${count}x '${recipe.name}'.`;
  if (totalMade > 0) msg += ` ${totalMade} item(s) went into your bags.`;
  if (totalMailed > 0) msg += ` ${totalMailed} item(s) were sent to your mailbox.`;
  if (totalUndelivered > 0) msg += ` (${totalUndelivered} item(s) could not be delivered.)`;
  return msg;
}
