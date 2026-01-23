// worldcore/mud/commands/economy/vendorCommand.ts
//
// Vendor command layer (v0).
//
// This module is intentionally thin:
// - DB access + definitions come from VendorService (ctx.vendors).
// - Actual buy/sell logic (gold + inventory) lives in VendorTransactions.
//
// Proximity:
// - Vendor proximity is enforced whenever we can evaluate it (session+entities).
// - If a specific vendor is targeted (explicit vendorId or a nearby handle like alchemist.1),
//   we require you to be close to THAT vendor's anchor (not merely any vendor).
//
// Quality-of-life:
// - You can omit vendorId and the command will infer the nearest vendor anchor in the room.
// - You can target a vendor by nearby short handle (e.g. "alchemist.1") and it will resolve
//   to the underlying vendor id (typically the NPC protoId/templateId), enabling:
//     vendor list alchemist.1
//     vendor buy  alchemist.1 1 2
//     vendor sell alchemist.1 herb_peacebloom 3
//

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";

import type { VendorDefinition } from "../../../vendors/VendorTypes";
import {
  buyFromVendor,
  resolveVendorItem,
  sellToVendor,
} from "../../../vendors/VendorTransactions";

import { logVendorEvent } from "../../../vendors/VendorAuditLog";

import { requireTownService } from "../world/serviceGates";

import {
  distanceXZ,
  getPlayerXZ,
  resolveNearbyHandleInRoom as resolveNearbyHandleInRoomShared,
} from "../../handles/NearbyHandles";
import type { HandleResolved } from "../../handles/NearbyHandles";

function norm(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function stripQuotes(v: string | undefined): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function looksLikeEntityHandle(s: string): boolean {
  // e.g. "alchemist.1" from nearby output.
  return /^[a-z0-9_]+\.[0-9]+$/i.test(String(s ?? "").trim());
}

function parsePositiveInt(s: string | undefined, fallback: number): number {
  const n = Number(String(s ?? "").trim());
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return i > 0 ? i : fallback;
}

function toNumber(x: unknown): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function getRoomId(ctx: MudContext, char: CharacterState): string | null {
  const rid =
    (ctx.session as any)?.roomId ??
    (ctx.session as any)?.room?.id ??
    (ctx.session as any)?.room?.roomId;

  if (typeof rid === "string" && rid.length > 0) return rid;

  // Best-effort fallback (some older flows stored region-ish identifiers here)
  const lastRegion = (char as any)?.lastRegionId;
  if (typeof lastRegion === "string" && lastRegion.length > 0) return lastRegion;

  return null;
}

function getEntitiesInRoom(ctx: MudContext, roomId: string): any[] {
  const ents = (ctx as any)?.entities?.getEntitiesInRoom?.(roomId);
  return Array.isArray(ents) ? ents : [];
}

function getNearbyTargetRadius(): number {
  const raw = String(process.env.PW_NEARBY_TARGET_RADIUS ?? "").trim();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

function vendorServiceRadius(): number {
  // Keep in sync with serviceGates.ts defaults.
  const raw = String(process.env.PW_SERVICE_RADIUS ?? "").trim();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 2.5;
}

function denyOutOfRange(dist: number): string {
  return `[service] You must be closer to use vendor. (dist ${dist.toFixed(1)} > ${vendorServiceRadius().toFixed(1)})`;
}

function denyNoSuchVendor(vendorId: string): string {
  return `[service] No vendor '${vendorId}' is available here.`;
}

function isVendorAnchorEntity(e: any): boolean {
  if (!e) return false;

  // Avoid targeting players.
  const hasSpawnPoint = typeof e.spawnPointId === "number";
  const isPlayerLike = !!e.ownerSessionId && !hasSpawnPoint;
  if (isPlayerLike) return false;

  const t = norm(e.type);
  const tags: string[] = Array.isArray(e.tags) ? e.tags.map(norm) : [];
  const roles: string[] = Array.isArray(e.roles) ? e.roles.map(norm) : [];
  const svcKind = norm(e.serviceKind);

  // Common anchor types.
  if (t === "vendor" || t === "merchant" || t === "shop") return true;

  // Tag-based anchors.
  if (tags.includes("service_vendor") || tags.includes("vendor")) return true;

  // Protected service NPCs may use protected_service + role/tag.
  if (tags.includes("protected_service") && (roles.includes("vendor") || tags.includes("service_vendor"))) {
    return true;
  }

  // serviceKind fallback.
  if (svcKind === "vendor") return true;

  return false;
}

function getServiceIdFromEntity(e: any): string {
  // Prefer protoId (spawn_points.protoId) then templateId, then model/archetype.
  const raw =
    e?.protoId ??
    e?.templateId ??
    e?.vendorId ??
    e?.serviceId ??
    e?.model ??
    e?.archetype ??
    "";
  return String(raw ?? "").trim();
}

async function maybeLoadVendorIdSet(ctx: MudContext): Promise<Set<string> | null> {
  const vendors: any = (ctx as any)?.vendors;
  if (!vendors?.listVendors) return null;
  try {
    const list = await vendors.listVendors();
    const s = new Set<string>();
    for (const v of list ?? []) {
      const id = norm((v as any)?.id);
      if (id) s.add(id);
    }
    return s;
  } catch {
    return null;
  }
}


function resolveNearbyHandleInRoom(
  ctx: MudContext,
  char: CharacterState,
  roomId: string,
  handle: string
): HandleResolved | null {
  const entities = getEntitiesInRoom(ctx, roomId);
  const viewerSessionId = String((ctx.session as any)?.id ?? "");

  // Exclude self by entity id (NOT by ownerSessionId),
  // because personal nodes also have ownerSessionId.
  const self = (ctx as any)?.entities?.getEntityByOwner?.(viewerSessionId);
  const selfId = self?.id;

  const { x: originX, z: originZ } = getPlayerXZ(ctx, char);

  return resolveNearbyHandleInRoomShared({
    entities,
    viewerSessionId,
    originX,
    originZ,
    radius: getNearbyTargetRadius(),
    excludeEntityId: selfId,
    limit: 200,
    handleRaw: handle,
  });
}

type VendorTarget =
  | { ok: true; vendorId: string; anchor?: { entity: any; dist: number }; inferred: boolean }
  | { ok: false; message: string };

async function resolveVendorTarget(
  ctx: MudContext,
  char: CharacterState,
  rawVendorId: string | null
): Promise<VendorTarget> {
  const roomId = getRoomId(ctx, char);
  if (!roomId) return { ok: false, message: "You are not in a world room." };

  const { x: px, z: pz } = getPlayerXZ(ctx, char);
  const ents = getEntitiesInRoom(ctx, roomId);

  const clean = String(rawVendorId ?? "").trim();

  // 1) Explicit handle targeting: vendor list alchemist.1
  if (clean && looksLikeEntityHandle(clean)) {
    const hit = resolveNearbyHandleInRoom(ctx, char, roomId, clean);
    if (!hit) return { ok: false, message: `Could not find target '${clean}'. Try 'nearby' first.` };

    const vendorId = getServiceIdFromEntity(hit.entity);
    if (!vendorId) return { ok: false, message: `Target '${clean}' is not a vendor.` };

    return { ok: true, vendorId, anchor: { entity: hit.entity, dist: hit.dist }, inferred: false };
  }

  // 2) If no id provided: infer nearest vendor anchor in room.
  if (!clean) {
    // First: prefer real vendor anchor heuristics.
    let best: { vendorId: string; entity: any; dist: number } | null = null;

    for (const e of ents) {
      if (!isVendorAnchorEntity(e)) continue;

      const ex = toNumber(e?.x ?? e?.pos?.x) ?? 0;
      const ez = toNumber(e?.z ?? e?.pos?.z) ?? 0;
      const dist = distanceXZ(ex, ez, px, pz);

      const vendorId = getServiceIdFromEntity(e);
      if (!vendorId) continue;

      if (!best || dist < best.dist) best = { vendorId, entity: e, dist };
    }

    // Fallback: if we didn't find a tagged vendor anchor, treat an NPC whose protoId/templateId
    // matches a vendor id in the DB as a vendor anchor.
    if (!best) {
      const vendorIds = await maybeLoadVendorIdSet(ctx);
      if (vendorIds && vendorIds.size > 0) {
        for (const e of ents) {
          if (!e) continue;
          const id = norm(getServiceIdFromEntity(e));
          if (!id || !vendorIds.has(id)) continue;

          const ex = toNumber(e?.x ?? e?.pos?.x) ?? 0;
          const ez = toNumber(e?.z ?? e?.pos?.z) ?? 0;
          const dist = distanceXZ(ex, ez, px, pz);

          if (!best || dist < best.dist) best = { vendorId: id, entity: e, dist };
        }
      }
    }

    if (!best) return { ok: false, message: "No vendor is nearby. Try: walkto vendor" };

    return { ok: true, vendorId: best.vendorId, anchor: { entity: best.entity, dist: best.dist }, inferred: true };
  }

  // 3) Explicit vendor id
  return { ok: true, vendorId: clean, inferred: false };
}

function canEvaluateProximity(ctx: MudContext): boolean {
  try {
    return !!(ctx as any)?.session && !!(ctx as any)?.entities && !!((ctx as any)?.session?.roomId);
  } catch {
    return false;
  }
}

function findNearestAnchorForVendorId(
  ctx: MudContext,
  char: CharacterState,
  roomId: string,
  vendorId: string
): { entity: any; dist: number } | null {
  const want = norm(vendorId);
  if (!want) return null;

  const { x: px, z: pz } = getPlayerXZ(ctx, char);
  const ents = getEntitiesInRoom(ctx, roomId);

  let best: { entity: any; dist: number } | null = null;

  for (const e of ents) {
    if (!e) continue;
    const got = norm(getServiceIdFromEntity(e));
    if (!got || got !== want) continue;

    const ex = toNumber(e?.x ?? e?.pos?.x) ?? 0;
    const ez = toNumber(e?.z ?? e?.pos?.z) ?? 0;
    const dist = distanceXZ(ex, ez, px, pz);

    if (!best || dist < best.dist) best = { entity: e, dist };
  }

  return best;
}

function enforceVendorSpecificProximity(
  ctx: MudContext,
  char: CharacterState,
  vendorId: string,
  anchorHint?: { entity: any; dist: number }
): string | null {
  if (!canEvaluateProximity(ctx)) return null;

  const roomId = getRoomId(ctx, char);
  if (!roomId) return null;

  const anchor = anchorHint ?? findNearestAnchorForVendorId(ctx, char, roomId, vendorId);
  if (!anchor) return denyNoSuchVendor(vendorId);

  if (anchor.dist > vendorServiceRadius()) return denyOutOfRange(anchor.dist);

  return null;
}

async function loadVendorOrError(
  ctx: MudContext,
  vendorId: string
): Promise<{ vendor: VendorDefinition } | { error: string }> {
  if (!ctx?.vendors?.getVendor) return { error: "Vendor service is not available." };
  const vendor = (await (ctx.vendors as any).getVendor(vendorId)) as VendorDefinition | null;
  if (!vendor) return { error: `[vendor] No vendor found with id '${vendorId}'.` };
  return { vendor };
}

function helpText(): string {
  return (
    "Vendor commands:\n" +
    "  vendor help\n" +
    "  vendor vendors                       - list vendor ids available in DB\n" +
    "  vendor list [vendorId|handle]        - list items for sale (omit id to use nearby vendor)\n" +
    "  vendor buy  [vendorId|handle] <index|rowId> [qty]  - buy item (omit id to use nearby vendor)\n" +
    "  vendor sell [vendorId|handle] <itemId|index|rowId> [qty] - sell item (omit id to use nearby vendor)\n" +
    "\n" +
    "Shortcuts (same syntax):\n" +
    "  buy  [vendorId|handle] <index|rowId> [qty]\n" +
    "  sell [vendorId|handle] <itemId|index|rowId> [qty]\n" +
    "\n" +
    "Notes:\n" +
    "  - <index> is the 1-based number shown in 'vendor list'.\n" +
    "  - <rowId> is the DB row id shown as (rowId=...).\n" +
    "  - You can target by nearby handle (e.g. 'vendor list alchemist.1').\n" +
    "  - Selling uses v0 rule: vendor pays 50% of their buy price (rounded down).\n"
  );
}

async function vendorsListAction(ctx: MudContext): Promise<string> {
  const rows = await (ctx.vendors as any).listVendors?.();
  if (!rows || rows.length === 0) return "[vendor] No vendors are defined in DB.";
  const lines = ["[vendor] Vendors:"];
  for (const r of rows) lines.push(`- ${r.id}: ${r.name}`);
  return lines.join("\n");
}

async function listAction(ctx: MudContext, char: CharacterState, args: string[]): Promise<string> {
  const raw = args[1] ? stripQuotes(args[1]) : null;

  return (await requireTownService(ctx, char, "vendor", async () => {
    const chosen = await resolveVendorTarget(ctx, char, raw);
    if (!chosen.ok) return `[vendor] ${chosen.message}`;

    // Enforce proximity to the specific vendor selected.
    const specificGate = enforceVendorSpecificProximity(ctx, char, chosen.vendorId, chosen.anchor);
    if (specificGate) return specificGate;

    const got = await loadVendorOrError(ctx, chosen.vendorId);
    if ("error" in got) return got.error;
    const vendor = got.vendor;

    const lines: string[] = [];
    lines.push(`Vendor: ${vendor.name} (${vendor.id})`);

    if (!vendor.items || vendor.items.length === 0) {
      lines.push("(No items for sale.)");
      return lines.join("\n");
    }

    vendor.items.forEach((vi: any, idx: number) => {
      const def = (ctx.items as any)?.getItemDefinition?.(vi.itemId) ?? (ctx.items as any)?.getItemDefinition?.(vi.itemId);
      const name = def?.name ?? vi.itemId;
      const rarity = def?.rarity ?? "common";
      lines.push(`${idx + 1}) ${name} [${rarity}] - ${vi.priceGold} gold (itemId: ${vi.itemId}, rowId=${vi.id})`);
    });

    lines.push("Buy: vendor buy [vendorId|handle] <index|rowId> [qty]");
    lines.push("Sell: vendor sell [vendorId|handle] <itemId|index|rowId> [qty]");
    return lines.join("\n");
  })) as string;
}

async function buyAction(ctx: MudContext, char: CharacterState, args: string[]): Promise<string> {
  // vendor buy [vendorId|handle] <index|rowId> [qty]
  // buy [vendorId|handle] <index|rowId> [qty]
  const a1 = args[1];
  if (!a1) return "[vendor] Usage: vendor buy [vendorId|handle] <index|rowId> [qty]";

  let rawVendorId: string | null = stripQuotes(a1);
  let selectorStr: string | undefined = args[2];
  let qtyStr: string | undefined = args[3];

  // Allow: buy <index|rowId> [qty] (infer vendor)
  // NOTE: keep handle behavior intact (don't treat handle as omission).
  if (/^\d+$/.test(rawVendorId)) {
    qtyStr = selectorStr;
    selectorStr = rawVendorId;
    rawVendorId = null;
  }

  if (!selectorStr) return "[vendor] Usage: vendor buy [vendorId|handle] <index|rowId> [qty]";

  return (await requireTownService(ctx, char, "vendor", async () => {
    const chosen = await resolveVendorTarget(ctx, char, rawVendorId);
    if (!chosen.ok) return `[vendor] ${chosen.message}`;

    // Enforce proximity to the specific vendor selected.
    const specificGate = enforceVendorSpecificProximity(ctx, char, chosen.vendorId, chosen.anchor);
    if (specificGate) return specificGate;

    const got = await loadVendorOrError(ctx, chosen.vendorId);
    if ("error" in got) return got.error;
    const vendor = got.vendor;

    const selector = parsePositiveInt(selectorStr, 0);
    if (selector <= 0) return "[vendor] Invalid selector. Use the list index or rowId.";

    const qty = parsePositiveInt(qtyStr, 1);

    const res = buyFromVendor(char, vendor, selector, qty);
    if (res.ok) {
      await (ctx.characters as any)?.saveCharacter?.(char);

      // Best-effort audit log (never blocks gameplay).
      await logVendorEvent({
        ts: new Date().toISOString(),
        shardId: (char as any)?.shardId ?? null,
        actorCharId: (char as any)?.id ?? null,
        actorCharName: (char as any)?.name ?? null,
        vendorId: vendor.id,
        vendorName: vendor.name ?? null,
        action: "buy",
        itemId: res.item?.itemId ?? null,
        quantity: res.quantity ?? null,
        unitPriceGold: res.item?.priceGold ?? null,
        totalGold: res.goldSpent ?? null,
        goldBefore: res.goldBefore ?? null,
        goldAfter: res.goldAfter ?? null,
        result: "ok",
        meta: { selector, qtyRequested: qty },
      });
    }
    return res.message;
  })) as string;
}

async function sellAction(ctx: MudContext, char: CharacterState, args: string[]): Promise<string> {
  // vendor sell [vendorId|handle] <itemId|index|rowId> [qty]
  // sell [vendorId|handle] <itemId|index|rowId> [qty]
  const a1 = args[1];
  if (!a1) return "[vendor] Usage: vendor sell [vendorId|handle] <itemId|index|rowId> [qty]";

  let rawVendorId: string | null = stripQuotes(a1);
  let selectorRaw: string | undefined = args[2];
  let qtyStr: string | undefined = args[3];

  // Allow: sell <itemId|index|rowId> [qty] (infer vendor)
  // If the first arg isn't a handle and there is no selector, treat it as selector.
  if (rawVendorId && !selectorRaw && !looksLikeEntityHandle(rawVendorId)) {
    selectorRaw = rawVendorId;
    rawVendorId = null;
  }

  if (!selectorRaw) return "[vendor] Usage: vendor sell [vendorId|handle] <itemId|index|rowId> [qty]";

  return (await requireTownService(ctx, char, "vendor", async () => {
    const chosen = await resolveVendorTarget(ctx, char, rawVendorId);
    if (!chosen.ok) return `[vendor] ${chosen.message}`;

    // Enforce proximity to the specific vendor selected.
    const specificGate = enforceVendorSpecificProximity(ctx, char, chosen.vendorId, chosen.anchor);
    if (specificGate) return specificGate;

    const got = await loadVendorOrError(ctx, chosen.vendorId);
    if ("error" in got) return got.error;
    const vendor = got.vendor;

    const qty = parsePositiveInt(qtyStr, 1);

    const selector = stripQuotes(selectorRaw);

    let itemId = selector;
    if (/^\d+$/.test(selector)) {
      const n = parsePositiveInt(selector, 0);
      const vi = resolveVendorItem(vendor, n);
      if (!vi) return "[vendor] That item is not recognized by this vendor.";
      itemId = vi.itemId;
    }

    const res = sellToVendor(char, itemId, qty, vendor);
    if (res.ok) {
      await (ctx.characters as any)?.saveCharacter?.(char);

      // Best-effort audit log (never blocks gameplay).
      // Sell price per unit is derived from vendor price reference.
      const vendorItem = vendor.items.find((i: any) => i.itemId === itemId);
      const unitPriceGold = vendorItem?.priceGold != null ? Math.floor(Number(vendorItem.priceGold) * 0.5) : null;

      await logVendorEvent({
        ts: new Date().toISOString(),
        shardId: (char as any)?.shardId ?? null,
        actorCharId: (char as any)?.id ?? null,
        actorCharName: (char as any)?.name ?? null,
        vendorId: vendor.id,
        vendorName: vendor.name ?? null,
        action: "sell",
        itemId,
        quantity: res.quantity ?? null,
        unitPriceGold,
        totalGold: res.goldGained ?? null,
        goldBefore: res.goldBefore ?? null,
        goldAfter: res.goldAfter ?? null,
        result: "ok",
        meta: { qtyRequested: qty },
      });
    }
    return res.message;
  })) as string;
}

export async function handleVendorCommand(
  ctx: MudContext,
  char: CharacterState,
  args: string[]
): Promise<string> {
  if (!ctx?.vendors) return "Vendor service is not available.";
  if (!ctx?.items) return "Item service is not available.";
  if (!ctx?.characters) return "Character service is not available.";

  const sub = norm(args[0] ?? "");

  if (!sub || sub === "help" || sub === "?" || sub === "h") return helpText();

  if (sub === "vendors") return vendorsListAction(ctx);

  if (sub === "list") return listAction(ctx, char, args);

  if (sub === "buy") return buyAction(ctx, char, args);

  if (sub === "sell") return sellAction(ctx, char, args);

  // Shorthand: `vendor <id|handle>` behaves like `vendor list <id|handle>`.
  if (args.length === 1 && args[0]) {
    return listAction(ctx, char, ["list", String(args[0])]);
  }

  return helpText();
}
