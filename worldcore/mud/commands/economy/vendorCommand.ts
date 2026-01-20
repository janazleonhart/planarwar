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
// - You may also pass an entity handle (e.g. "alchemist.1"); we treat it as "use nearby vendor".
//

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";

import type { VendorDefinition } from "../../../vendors/VendorTypes";
import {
  buyFromVendor,
  resolveVendorItem,
  sellToVendor,
} from "../../../vendors/VendorTransactions";

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
  const raw = e?.protoId ?? e?.templateId ?? e?.vendorId ?? e?.serviceId ?? e?.model ?? e?.archetype ?? "";
  return String(raw ?? "").trim();
}

function getNearbyVendorId(ctx: MudContext, char: CharacterState): string | null {
  const roomId = getRoomId(ctx, char);
  if (!roomId) return null;

  const { x: px, z: pz } = getPlayerXZ(ctx, char);
  const ents = getEntitiesInRoom(ctx, roomId);

  let best: { vendorId: string; dist: number } | null = null;

  for (const e of ents) {
    if (!isVendorAnchorEntity(e)) continue;

    const ex = typeof e.x === "number" ? e.x : typeof e?.pos?.x === "number" ? e.pos.x : 0;
    const ez = typeof e.z === "number" ? e.z : typeof e?.pos?.z === "number" ? e.pos.z : 0;

    const dx = ex - px;
    const dz = ez - pz;
    const dist = Math.sqrt(dx * dx + dz * dz);

    const vendorId = getServiceIdFromEntity(e);
    if (!vendorId) continue;

    if (!best || dist < best.dist) best = { vendorId, dist };
  }

  return best?.vendorId ?? null;
}

async function loadVendorOrError(ctx: MudContext, vendorId: string): Promise<{ vendor: VendorDefinition } | { error: string }> {
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
    "  - Selling uses v0 rule: vendor pays 50% of their buy price (rounded down).\n"
  );
}

function ensureVendorId(
  ctx: MudContext,
  char: CharacterState,
  rawVendorId: string | null
): { ok: true; vendorId: string } | { ok: false; message: string } {
  // Entity handles like "alchemist.1" are not vendor ids. Treat as "use nearby vendor".
  if (rawVendorId && looksLikeEntityHandle(rawVendorId)) rawVendorId = null;

  if (!rawVendorId) {
    const nearby = getNearbyVendorId(ctx, char);
    if (!nearby) return { ok: false, message: "No vendor is nearby. Try: walkto vendor" };
    return { ok: true, vendorId: nearby };
  }

  return { ok: true, vendorId: rawVendorId };
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
  const chosen = ensureVendorId(ctx, char, raw);
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
    const def = (ctx.items as any)?.getItemDefinition?.(vi.itemId) ?? (ctx.items as any)?.getItemDefinition?.(vi.itemId);
    const name = def?.name ?? vi.itemId;
    const rarity = def?.rarity ?? "common";
    lines.push(
      `${idx + 1}) ${name} [${rarity}] - ${vi.priceGold} gold (itemId: ${vi.itemId}, rowId=${vi.id})`
    );
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
  if (/^\d+$/.test(rawVendorId)) {
    qtyStr = selectorStr;
    selectorStr = rawVendorId;
    rawVendorId = null;
  }

  // Allow: buy <handle> <index|rowId> [qty] (infer vendor)
  if (rawVendorId && looksLikeEntityHandle(rawVendorId)) {
    rawVendorId = null;
  }

  // If vendorId omitted via handle, selector shifts.
  if (!rawVendorId && !selectorStr && args[2]) {
    selectorStr = args[2];
    qtyStr = args[3];
  }

  if (!selectorStr) return "[vendor] Usage: vendor buy [vendorId] <index|rowId> [qty]";

  const chosen = ensureVendorId(ctx, char, rawVendorId);
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
    rawVendorId = null;
  }

  if (!selectorRaw) return "[vendor] Usage: vendor sell [vendorId] <itemId|index|rowId> [qty]";

  const chosen = ensureVendorId(ctx, char, rawVendorId);
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

export async function handleVendorCommand(ctx: MudContext, char: CharacterState, args: string[]): Promise<string> {
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
