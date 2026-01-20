// worldcore/mud/commands/economy/vendorCommand.ts
//
// Vendor command layer (v0).
//
// This module is intentionally thin:
// - DB access + definitions come from VendorService (ctx.vendors).
// - Actual buy/sell logic (gold + inventory) lives in VendorTransactions.
// - Proximity gating is enforced by requireTownService(...) in serviceGates.ts.
//
// Quality-of-life:
// - You can omit vendorId and the command will infer the nearest vendor anchor in the room.
// - You may also pass an entity handle (e.g. "alchemist.1").
// - While we standardize NPC service tags, we also support a fallback: if an entity's
//   protoId/templateId/vendorId/serviceId matches a vendor id in the DB, treat it as a vendor anchor.
//

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";

import type { VendorDefinition } from "../../../vendors/VendorTypes";
import { buyFromVendor, resolveVendorItem, sellToVendor } from "../../../vendors/VendorTransactions";
import { requireTownService } from "../world/serviceGates";

function trimStr(v: unknown): string {
  return String(v ?? "").trim();
}

function norm(v: unknown): string {
  return trimStr(v).toLowerCase();
}

function stripQuotes(v: string | undefined): string {
  const s = trimStr(v);
  if (!s) return "";
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function looksLikeEntityHandle(s: string): boolean {
  // e.g. "alchemist.1" from nearby output.
  return /^[a-z0-9_]+\.[0-9]+$/i.test(trimStr(s));
}

function parsePositiveInt(s: string | undefined, fallback: number): number {
  const n = Number(trimStr(s));
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return i > 0 ? i : fallback;
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

function getPlayerXZ(ctx: MudContext, char: CharacterState): { x: number; z: number } {
  // Prefer the live entity (authoritative for movement).
  const ent = (ctx.entities as any)?.getEntityByOwner?.((ctx.session as any)?.id) as any;

  const x =
    (typeof ent?.x === "number" ? ent.x : undefined) ??
    (typeof (char as any)?.pos?.x === "number" ? (char as any).pos.x : undefined) ??
    (typeof (char as any)?.posX === "number" ? (char as any).posX : undefined) ??
    0;

  const z =
    (typeof ent?.z === "number" ? ent.z : undefined) ??
    (typeof (char as any)?.pos?.z === "number" ? (char as any).pos.z : undefined) ??
    (typeof (char as any)?.posZ === "number" ? (char as any).posZ : undefined) ??
    0;

  return { x, z };
}

function getEntitiesInRoom(ctx: MudContext, roomId: string): any[] {
  const ents = (ctx.entities as any)?.getEntitiesInRoom?.(roomId);
  return Array.isArray(ents) ? ents : [];
}

function resolveEntityInRoomByHandleDuck(ctx: MudContext, roomId: string, handle: string): any | null {
  const em: any = ctx.entities as any;
  const fns: any[] = [
    em?.resolveInRoomByHandle,
    em?.getEntityInRoomByHandle,
    em?.findEntityInRoomByHandle,
    em?.resolveHandleInRoom,
    em?.resolveHandle,
    em?.getByHandle,
    em?.findByHandle,
  ].filter((fn) => typeof fn === "function");

  for (const fn of fns) {
    try {
      const r1 = fn.call(em, roomId, handle);
      if (r1) return r1;
    } catch {}
    try {
      const r2 = fn.call(em, handle, roomId);
      if (r2) return r2;
    } catch {}
    try {
      const r3 = fn.call(em, handle);
      if (r3) return r3;
    } catch {}
  }
  return null;
}

function isVendorAnchorEntity(e: any): boolean {
  if (!e) return false;

  // Avoid targeting players.
  const hasSpawnPoint = typeof e.spawnPointId === "number";
  const isPlayerLike = !!e.ownerSessionId && !hasSpawnPoint;
  if (isPlayerLike) return false;

  const t = norm(e.type);
  const name = norm(e.name);
  const id = norm(e.id);
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

  // Legacy heuristic fallback (older content / simple prototypes).
  if (name.includes("vendor") || name.includes("shop") || name.includes("merchant")) return true;
  if (id.includes("vendor") || id.includes("shop")) return true;
  if (norm((e as any).protoId).includes("vendor")) return true;

  return false;
}

function getServiceIdFromEntity(e: any): string {
  // Prefer explicit mapping fields first, then proto/template.
  const raw = e?.vendorId ?? e?.serviceId ?? e?.protoId ?? e?.templateId ?? e?.model ?? e?.archetype ?? "";
  return trimStr(raw);
}

// --- VendorId cache (DB-derived) ---------------------------------------------

type VendorIdCache = {
  at: number;
  idsLower: Set<string>;
  idByLower: Map<string, string>;
};

let _VENDOR_ID_CACHE: VendorIdCache | null = null;
const VENDOR_ID_CACHE_TTL_MS = 30_000;

async function getVendorIdCache(ctx: MudContext): Promise<VendorIdCache | null> {
  const svc: any = (ctx as any).vendors;
  if (!svc || typeof svc.listVendors !== "function") return null;

  const now = Date.now();
  if (_VENDOR_ID_CACHE && now - _VENDOR_ID_CACHE.at < VENDOR_ID_CACHE_TTL_MS) return _VENDOR_ID_CACHE;

  try {
    const list = await svc.listVendors();
    const idsLower = new Set<string>();
    const idByLower = new Map<string, string>();

    if (Array.isArray(list)) {
      for (const v of list) {
        const id = trimStr((v as any)?.id);
        const k = norm(id);
        if (!k) continue;
        idsLower.add(k);
        if (!idByLower.has(k)) idByLower.set(k, id);
      }
    }

    _VENDOR_ID_CACHE = { at: now, idsLower, idByLower };
    return _VENDOR_ID_CACHE;
  } catch {
    return null;
  }
}

function canonicalizeVendorId(cache: VendorIdCache | null, raw: string): string {
  const s = trimStr(raw);
  if (!s) return "";
  if (!cache) return s;
  const k = norm(s);
  return cache.idByLower.get(k) ?? s;
}

function explicitVendorIdFromEntity(e: any): string {
  // Explicit mapping fields that content authors can set.
  const v = trimStr(e?.vendorId ?? e?.serviceId ?? "");
  return v;
}

function dbMatchedVendorIdFromEntity(cache: VendorIdCache, e: any): string {
  // Accept protoId/templateId *and* the explicit fields when they match a DB vendor id.
  const candidates: string[] = [
    trimStr(e?.vendorId),
    trimStr(e?.serviceId),
    trimStr(e?.protoId),
    trimStr(e?.templateId),
  ].filter(Boolean);

  for (const c of candidates) {
    const k = norm(c);
    if (!k) continue;
    const canon = cache.idByLower.get(k);
    if (canon) return canon;
  }
  return "";
}

async function getNearbyVendorId(ctx: MudContext, char: CharacterState): Promise<string> {
  const roomId = getRoomId(ctx, char);
  if (!roomId) return "";

  const { x: px, z: pz } = getPlayerXZ(ctx, char);
  const ents = getEntitiesInRoom(ctx, roomId);
  if (ents.length === 0) return "";

  const cache = await getVendorIdCache(ctx);

  let bestVendorId = "";
  let bestDist = Infinity;

  for (const e of ents) {
    if (!e) continue;

    const ex = typeof e.x === "number" ? e.x : typeof e?.pos?.x === "number" ? e.pos.x : 0;
    const ez = typeof e.z === "number" ? e.z : typeof e?.pos?.z === "number" ? e.pos.z : 0;

    const dx = ex - px;
    const dz = ez - pz;
    const dist = Math.sqrt(dx * dx + dz * dz);

    const isAnchor = isVendorAnchorEntity(e);

    let vendorId = "";

    if (cache) {
      // Strongest signal: entity's fields match a known DB vendor id.
      vendorId = dbMatchedVendorIdFromEntity(cache, e);

      // Next: explicit mapping fields even if DB list isn't matched (still useful for debugging).
      if (!vendorId && isAnchor) {
        const explicit = explicitVendorIdFromEntity(e);
        if (explicit) vendorId = canonicalizeVendorId(cache, explicit);
      }

      // Finally: for anchors, try a serviceId string (might be vendorId in good data).
      if (!vendorId && isAnchor) {
        const sid = canonicalizeVendorId(cache, getServiceIdFromEntity(e));
        // Only accept if it resolves to a DB vendor id.
        if (sid && cache.idsLower.has(norm(sid))) vendorId = sid;
      }

      // Fallback anchor detection: even if it isn't tagged as a vendor, protoId/templateId may match.
      if (!isAnchor && vendorId) {
        // ok (db-matched fallback)
      } else if (!isAnchor && !vendorId) {
        continue;
      }

      // If it's an anchor but we still couldn't get any usable vendorId, skip it.
      if (isAnchor && !vendorId) continue;
    } else {
      // No DB list: rely on tags/type/serviceKind and use explicit/serviceId strings.
      if (!isAnchor) continue;

      vendorId = explicitVendorIdFromEntity(e) || getServiceIdFromEntity(e);
      vendorId = trimStr(vendorId);
      if (!vendorId) continue;
    }

    if (dist < bestDist) {
      bestDist = dist;
      bestVendorId = vendorId;
    }
  }

  return bestVendorId;
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
    "  - Selling uses v0 rule: vendor pays 50% of their buy price (rounded down).\n" +
    "  - You can use 'walkto vendor' to move into range before listing/buying/selling.\n"
  );
}

async function ensureVendorId(
  ctx: MudContext,
  char: CharacterState,
  rawVendorId: string | null
): Promise<{ ok: true; vendorId: string } | { ok: false; message: string }> {
  const raw = rawVendorId ? trimStr(rawVendorId) : "";

  // If an entity handle was provided, try to resolve *that* entity to a vendorId.
  // This allows targeting a specific vendor when multiple vendors are in the room.
  if (raw && looksLikeEntityHandle(raw)) {
    const roomId = getRoomId(ctx, char);
    if (roomId) {
      const e = resolveEntityInRoomByHandleDuck(ctx, roomId, raw);
      if (e) {
        const cache = await getVendorIdCache(ctx);
        let vendorId = "";

        if (cache) {
          vendorId = dbMatchedVendorIdFromEntity(cache, e);
          if (!vendorId) {
            const explicit = explicitVendorIdFromEntity(e);
            if (explicit) vendorId = canonicalizeVendorId(cache, explicit);
          }
          if (!vendorId) {
            const sid = canonicalizeVendorId(cache, getServiceIdFromEntity(e));
            if (sid && cache.idsLower.has(norm(sid))) vendorId = sid;
          }
        } else {
          vendorId = explicitVendorIdFromEntity(e) || getServiceIdFromEntity(e);
          vendorId = trimStr(vendorId);
        }

        if (vendorId) return { ok: true, vendorId };
      }
    }

    // Treat unknown handles as "use nearby vendor".
    rawVendorId = null;
  }

  // Explicit vendorId.
  if (rawVendorId && trimStr(rawVendorId)) {
    const cache = await getVendorIdCache(ctx);
    const canon = canonicalizeVendorId(cache, trimStr(rawVendorId));
    return { ok: true, vendorId: canon };
  }

  // Infer from nearby vendor anchors.
  const nearby = await getNearbyVendorId(ctx, char);
  if (!nearby) return { ok: false, message: "No vendor is nearby. Try: walkto vendor" };
  return { ok: true, vendorId: nearby };
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
  const chosen = await ensureVendorId(ctx, char, raw);
  if (!chosen.ok) return `[vendor] ${chosen.message}`;

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
    const def = (ctx.items as any)?.getItemDefinition?.(vi.itemId);
    const name = def?.name ?? vi.itemId;
    const rarity = def?.rarity ?? "common";
    lines.push(`${idx + 1}) ${name} [${rarity}] - ${vi.priceGold} gold (itemId: ${vi.itemId}, rowId=${vi.id})`);
  });

  lines.push("Buy: vendor buy [vendorId] <index|rowId> [qty]");
  lines.push("Sell: vendor sell [vendorId] <itemId|index|rowId> [qty]");
  return lines.join("\n");
}

async function buyAction(ctx: MudContext, char: CharacterState, args: string[]): Promise<string> {
  // vendor buy [vendorId|handle] <index|rowId> [qty]
  // buy [vendorId|handle] <index|rowId> [qty]
  const a1 = args[1];
  if (!a1) return "[vendor] Usage: vendor buy [vendorId] <index|rowId> [qty]";

  let rawVendorId: string | null = stripQuotes(a1);
  let selectorStr: string | undefined = args[2];
  let qtyStr: string | undefined = args[3];

  // Allow: buy <index|rowId> [qty] (infer vendor)
  if (/^\d+$/.test(trimStr(rawVendorId))) {
    qtyStr = selectorStr;
    selectorStr = rawVendorId;
    rawVendorId = null;
  }

  // Allow: buy <handle> <index|rowId> [qty] (infer vendor)
  if (rawVendorId && looksLikeEntityHandle(rawVendorId)) {
    // keep the handle so ensureVendorId can attempt to resolve it.
  }

  if (!selectorStr) return "[vendor] Usage: vendor buy [vendorId] <index|rowId> [qty]";

  const chosen = await ensureVendorId(ctx, char, rawVendorId);
  if (!chosen.ok) return `[vendor] ${chosen.message}`;

  const got = await loadVendorOrError(ctx, chosen.vendorId);
  if ("error" in got) return got.error;
  const vendor = got.vendor;

  const selector = parsePositiveInt(selectorStr, 0);
  if (selector <= 0) return "[vendor] Invalid selector. Use the list index or rowId.";

  const qty = parsePositiveInt(qtyStr, 1);

  const res = buyFromVendor(char, vendor, selector, qty);
  if (res.ok) {
    await (ctx.characters as any)?.saveCharacter?.(char);
  }
  return res.message;
}

async function sellAction(ctx: MudContext, char: CharacterState, args: string[]): Promise<string> {
  // vendor sell [vendorId|handle] <itemId|index|rowId> [qty]
  // sell [vendorId|handle] <itemId|index|rowId> [qty]
  const a1 = args[1];
  if (!a1) return "[vendor] Usage: vendor sell [vendorId] <itemId|index|rowId> [qty]";

  let rawVendorId: string | null = stripQuotes(a1);
  let selectorRaw: string | undefined = args[2];
  let qtyStr: string | undefined = args[3];

  // Allow: sell <itemId|index|rowId> [qty] (infer vendor)
  if (rawVendorId && !selectorRaw) {
    selectorRaw = rawVendorId;
    rawVendorId = null;
  }

  // Allow: sell <handle> <itemId|index|rowId> [qty] (infer vendor)
  if (rawVendorId && looksLikeEntityHandle(rawVendorId)) {
    // keep the handle so ensureVendorId can attempt to resolve it.
  }

  if (!selectorRaw) return "[vendor] Usage: vendor sell [vendorId] <itemId|index|rowId> [qty]";

  const chosen = await ensureVendorId(ctx, char, rawVendorId);
  if (!chosen.ok) return `[vendor] ${chosen.message}`;

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
  }
  return res.message;
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

  if (sub === "list")
    return (await requireTownService(ctx, char, "vendor", () => listAction(ctx, char, args))) as string;

  if (sub === "buy")
    return (await requireTownService(ctx, char, "vendor", () => buyAction(ctx, char, args))) as string;

  if (sub === "sell")
    return (await requireTownService(ctx, char, "vendor", () => sellAction(ctx, char, args))) as string;

  // Shorthand: `vendor <id|handle>` behaves like `vendor list <id|handle>`.
  if (args.length === 1 && args[0]) {
    return (await requireTownService(ctx, char, "vendor", () =>
      listAction(ctx, char, ["list", String(args[0])])
    )) as string;
  }

  return helpText();
}
