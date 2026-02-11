// worldcore/mud/commands/world/serviceGates.ts
//
// Service gating: certain town services (bank, vendor, mailbox, etc.) should only be
// usable when you are physically near the matching service anchor entity.
//
// NOTE:
// - Most services can be toggled via PW_SERVICE_GATES.
// - Vendor proximity is enforced whenever we have enough runtime context
//   (session+entities), even if PW_SERVICE_GATES is off. This prevents "remote shopping"
//   which breaks the town loop.
//
// This file must remain test-friendly: if we cannot evaluate proximity (no session/entities),
// we do NOT block.
//

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";

import { getRegionFlags, isEconomyLockdownOnSiegeFromFlags } from "../../../world/RegionFlags";

type ServiceName = "bank" | "guildbank" | "vendor" | "auction" | "mail" | "trainer";

// Forge/station interactions generally use ~2.5 in the walk-to loop.
const DEFAULT_SERVICE_RADIUS = 2.5;

function norm(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

function toNumber(x: unknown): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function getRoomId(session: any): string | null {
  const rid =
    session?.roomId ??
    session?.room?.id ??
    session?.room?.roomId ??
    session?.world?.roomId;
  return rid ? String(rid) : null;
}

function parseRoomCoord(roomId: string): { shard: string; regionId: string } | null {
  // Expected: "shardId:x,z" (x,z integers). RegionFlags stores "x,z" in DB.
  const s = String(roomId ?? "");
  const i = s.indexOf(":");
  if (i <= 0) return null;
  const shard = s.slice(0, i);
  const rest = s.slice(i + 1);
  if (!rest) return null;
  // Keep as "x,z" (RegionFlags normalizes later).
  return { shard, regionId: rest };
}

function getPlayerPos(char: any): { x: number; z: number } | null {
  const x = toNumber(char?.pos?.x ?? char?.x ?? char?.posX);
  const z = toNumber(char?.pos?.z ?? char?.z ?? char?.posZ);
  if (x === null || z === null) return null;
  return { x, z };
}

function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function serviceGatesEnabled(): boolean {
  // Default: off for dev ergonomics.
  // Vendor is enforced separately when possible.
  const v = process.env.PW_SERVICE_GATES;
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function serviceRadius(): number {
  const v = process.env.PW_SERVICE_RADIUS;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SERVICE_RADIUS;
}

function strictRequiredFor(service: ServiceName): boolean {
  // Vendor is a hard gameplay constraint: every town should have one,
  // and you should not be able to buy/sell remotely.
  if (service === "vendor") return true;

  const v = process.env.PW_SERVICE_GATES_STRICT;
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function serviceKindFor(service: ServiceName): string {
  return service;
}

function isServiceAnchorEntity(e: any, service: ServiceName): boolean {
  const t = norm(e?.type);
  const tags: string[] = Array.isArray(e?.tags) ? e.tags.map((x: any) => norm(x)) : [];
  const roles: string[] = Array.isArray(e?.roles) ? e.roles.map((x: any) => norm(x)) : [];

  const svc = serviceKindFor(service);

  // Type-based anchors.
  if (t === svc) return true;
  if (service === "vendor" && (t === "vendor" || t === "merchant" || t === "shop")) return true;
  if (service === "guildbank" && (t === "guildbank" || t === "gbank")) return true;
  if (service === "auction" && (t === "auction" || t === "ah" || t === "auctioneer")) return true;
  if (service === "mail" && (t === "mail" || t === "mailbox")) return true;
  if (
    service === "trainer" &&
    (t === "trainer" || t === "spelltrainer" || t === "abilitytrainer" || t === "class_trainer" || t === "class_trainer_npc")
  )
    return true;

  // Tag-based anchors.
  const wantTag = `service_${svc}`;
  if (tags.includes(wantTag)) return true;

  // Protected service NPCs (guards/immortal services) can be tagged in two layers.
  // Example: protected_service + role vendor
  if (tags.includes("protected_service") && (roles.includes(svc) || tags.includes(svc))) return true;

  // Back-compat / loose matching.
  if (tags.includes(svc)) return true;

  return false;
}

type AnchorMatch = {
  entity: any;
  dist: number;
  serviceId: string; // protoId/templateId (best effort)
};

function getServiceIdFromEntity(e: any): string {
  // Prefer protoId (spawn_points.protoId) then templateId, then model/archetype.
  const raw = e?.protoId ?? e?.templateId ?? e?.model ?? e?.archetype ?? "";
  return String(raw ?? "").trim();
}

function findNearestAnchor(
  ctx: MudContext,
  char: CharacterState,
  service: ServiceName,
  opts?: { vendorIds?: Set<string> }
): AnchorMatch | null {
  const roomId = getRoomId((ctx as any)?.session);
  if (!roomId) return null;

  const em: any = (ctx as any)?.entities;
  if (!em?.getEntitiesInRoom) return null;

  const ents: any[] = em.getEntitiesInRoom(roomId) ?? [];
  const pos = getPlayerPos(char as any);
  if (!pos) return null;

  const wantVendorIds = service === "vendor" ? opts?.vendorIds : undefined;

  let best: AnchorMatch | null = null;
  for (const e of ents) {
    const isAnchor =
      isServiceAnchorEntity(e, service) ||
      (service === "vendor" &&
        !!wantVendorIds &&
        wantVendorIds.has(norm(getServiceIdFromEntity(e))));

    if (!isAnchor) continue;

    const ex = toNumber(e?.x ?? e?.pos?.x);
    const ez = toNumber(e?.z ?? e?.pos?.z);
    if (ex === null || ez === null) continue;

    const d = Math.sqrt(dist2(pos.x, pos.z, ex, ez));
    const serviceId = getServiceIdFromEntity(e);

    if (!best || d < best.dist) best = { entity: e, dist: d, serviceId };
  }

  return best;
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

// Local bypass logic: do not import shared auth types from other packages.
// This stays robust across builds by duck-typing.
function canBypassServiceGates(auth: any): boolean {
  if (!auth) return false;

  if (auth.isAdmin === true || auth.isDev === true) return true;

  const roles = Array.isArray(auth.roles) ? auth.roles.map(norm) : [];
  const scopes = Array.isArray(auth.scopes) ? auth.scopes.map(norm) : [];
  const perms = Array.isArray(auth.permissions) ? auth.permissions.map(norm) : [];

  if (roles.includes("admin") || roles.includes("dev")) return true;
  if (scopes.includes("admin") || scopes.includes("dev")) return true;
  if (perms.includes("bypass_service_gates") || perms.includes("service_gates_bypass")) return true;

  if (auth.flags && typeof auth.flags === "object") {
    if (auth.flags.bypassServiceGates === true || auth.flags.bypass_service_gates === true) return true;
  }

  return false;
}

function shouldBypass(ctx: MudContext): boolean {
  try {
    const auth = (ctx as any)?.session?.auth;
    return canBypassServiceGates(auth);
  } catch {
    return false;
  }
}

function denyNoAnchor(service: ServiceName): string {
  return `[service] No ${service} service is available here.`;
}

function denyOutOfRange(service: ServiceName, dist: number): string {
  return `[service] You must be closer to use ${service}. (dist ${dist.toFixed(1)} > ${serviceRadius().toFixed(
    1
  )})`;
}

function denySiegeLockdown(service: ServiceName): string {
  if (service === "vendor") return "[vendor] The shop is closed. The town is under siege.";
  return `[service] ${service} is unavailable. The town is under siege.`;
}

/**
 * Gate a town service call.
 *
 * - If PW_SERVICE_GATES is disabled, we normally let the call through.
 * - Vendor is special: if we can evaluate proximity (session+entities), we enforce it.
 */
export async function requireTownService<T>(
  ctx: MudContext,
  char: CharacterState,
  service: ServiceName,
  run: () => Promise<T> | T
): Promise<T | string> {
  const isVendor = service === "vendor";
  const gatesOn = serviceGatesEnabled();

  // If we can't reason about proximity (tests, headless contexts), don't block.
  const canEvaluateProximity =
    !!(ctx as any)?.session && !!(ctx as any)?.entities && !!getRoomId((ctx as any)?.session);

  const shouldGate = (gatesOn && !isVendor) || (isVendor && canEvaluateProximity);

  if (!shouldGate) return run();
  if (shouldBypass(ctx)) return run();

  // Siege lockdown: when enabled for the region, deny certain services while the town is under siege.
  // This must remain test-friendly and fail-open if we lack context.
  if (service === "vendor") {
    try {
      const roomId = getRoomId((ctx as any)?.session);
      const siege: any = (ctx as any)?.townSiege;
      if (roomId && siege?.isUnderSiege && siege.isUnderSiege(roomId) === true) {
        const c = parseRoomCoord(roomId);
        if (c) {
          const flags = await getRegionFlags(c.shard, c.regionId);
          if (isEconomyLockdownOnSiegeFromFlags(flags)) {
            return denySiegeLockdown(service);
          }
        }
      }
    } catch {
      // fail-open
    }
  }

  const vendorIds = isVendor ? await maybeLoadVendorIdSet(ctx) : null;
  const anchor = findNearestAnchor(ctx, char, service, { vendorIds: vendorIds ?? undefined });

  if (!anchor) {
    if (strictRequiredFor(service)) return denyNoAnchor(service);
    return run();
  }

  if (anchor.dist > serviceRadius()) return denyOutOfRange(service, anchor.dist);

  return run();
}
