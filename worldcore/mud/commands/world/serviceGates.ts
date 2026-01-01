// worldcore/mud/commands/world/serviceGates.ts
import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";
import { isGMOrHigher } from "../../../shared/AuthTypes";

type ServiceName = "bank" | "guildbank" | "vendor" | "auction" | "mail";

function envBool(name: string): boolean {
  const v = (process.env[name] ?? "").toString().trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function envInt(name: string, fallback: number): number {
  const raw = (process.env[name] ?? "").toString().trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

/**
 * Enable/disable world service gating.
 *
 * - default: OFF (dev friendly)
 * - enable: PW_SERVICE_GATES=1 (or WORLD_SERVICE_GATES=1)
 */
export function serviceGatesEnabled(): boolean {
  return envBool("PW_SERVICE_GATES") || envBool("WORLD_SERVICE_GATES");
}

/**
 * Strict anchor mode:
 * - If enabled, services REQUIRE a matching service anchor nearby.
 * - If disabled (default), missing anchors fall back to "town/safe_hub region" rule.
 */
function strictAnchors(): boolean {
  return envBool("PW_SERVICE_GATES_STRICT");
}

function serviceRadius(service: ServiceName): number {
  // Allow per-service override later, but keep it simple now.
  // Examples:
  //   PW_SERVICE_RADIUS=12
  //   PW_SERVICE_RADIUS_MAIL=10
  const base = envInt("PW_SERVICE_RADIUS", 12);
  const per =
    envInt(
      `PW_SERVICE_RADIUS_${service.toUpperCase()}`,
      Number.NaN as any
    );
  return Number.isFinite(per) ? per : base;
}

function norm(s: any): string {
  return String(s ?? "").trim().toLowerCase();
}

function getPlayerXZ(ctx: MudContext, char: CharacterState): { x: number; z: number } {
  const ent = (ctx.entities as any)?.getEntityByOwner?.(ctx.session.id) as any;
  const x =
    (typeof ent?.x === "number" ? ent.x : undefined) ??
    (typeof (char as any)?.posX === "number" ? (char as any).posX : undefined) ??
    0;
  const z =
    (typeof ent?.z === "number" ? ent.z : undefined) ??
    (typeof (char as any)?.posZ === "number" ? (char as any).posZ : undefined) ??
    0;
  return { x, z };
}

function isStaffBypass(ctx: MudContext): boolean {
  const flags = (ctx.session as any)?.identity?.flags;
  return isGMOrHigher(flags);
}

function isTownLike(ctx: MudContext, x: number, z: number): boolean {
  const world: any = (ctx as any).world;
  if (!world?.getRegionAt) return true; // permissive if world isn't wired
  const region = world.getRegionAt(x, z);
  const tags: string[] = Array.isArray(region?.tags) ? region.tags : [];
  const flags: any = region?.flags ?? {};
  return (
    tags.includes("town") ||
    tags.includes("safe_hub") ||
    flags.isTown === true ||
    flags.isSafeHub === true
  );
}

type AnchorMatch = {
  id: string;
  name: string;
  type: string;
  x: number;
  z: number;
  dist: number;
};

function getRoomId(ctx: MudContext, char: CharacterState): string | null {
  const roomId = (ctx.session as any)?.roomId;
  if (typeof roomId === "string" && roomId.length > 0) return roomId;

  const ent = (ctx.entities as any)?.getEntityByOwner?.(ctx.session.id) as any;
  const r = ent?.roomId;
  if (typeof r === "string" && r.length > 0) return r;

  const lastRegion = (char as any)?.lastRegionId;
  if (typeof lastRegion === "string" && lastRegion.length > 0) return lastRegion;

  return null;
}

function getEntitiesInRoom(ctx: MudContext, roomId: string): any[] {
  const ents = (ctx.entities as any)?.getEntitiesInRoom?.(roomId);
  return Array.isArray(ents) ? ents : [];
}

function isServiceAnchorEntity(e: any, service: ServiceName): boolean {
  if (!e) return false;

  // Avoid targeting players.
  const hasSpawnPoint = typeof e.spawnPointId === "number";
  const isPlayerLike = !!e.ownerSessionId && !hasSpawnPoint;
  if (isPlayerLike) return false;

  const t = norm(e.type);
  const tags = Array.isArray(e.tags) ? e.tags.map(norm) : [];
  const roles = Array.isArray(e.roles) ? e.roles.map(norm) : [];
  const svcKind = norm(e.serviceKind);

  const wantTag =
    service === "guildbank" ? "service_bank" : `service_${service}`;

  // Types that count as anchors (you can expand later)
  const typeMatches =
    (service === "mail" && (t === "mailbox" || t === "mail")) ||
    ((service === "bank" || service === "guildbank") && (t === "banker" || t === "bank")) ||
    (service === "auction" && (t === "auctioneer" || t === "auction")) ||
    (service === "vendor" && (t === "vendor" || t === "merchant"));

  const tagMatches =
    tags.includes(wantTag) ||
    tags.includes("protected_service") && tags.some((x: string) => x.startsWith("service_")) &&
      (tags.includes(wantTag) || svcKind === service);

  const roleMatches = roles.includes(wantTag) || roles.includes(service);

  const kindMatches = svcKind === service || (service === "guildbank" && svcKind === "bank");

  return !!(typeMatches || tagMatches || roleMatches || kindMatches);
}

function findNearestAnchor(
  ctx: MudContext,
  char: CharacterState,
  service: ServiceName
): AnchorMatch | null {
  const roomId = getRoomId(ctx, char);
  if (!roomId) return null;

  const { x: px, z: pz } = getPlayerXZ(ctx, char);
  const ents = getEntitiesInRoom(ctx, roomId);

  let best: AnchorMatch | null = null;
  for (const e of ents) {
    if (!isServiceAnchorEntity(e, service)) continue;
    const ex = typeof e.x === "number" ? e.x : 0;
    const ez = typeof e.z === "number" ? e.z : 0;

    const dx = ex - px;
    const dz = ez - pz;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (!best || dist < best.dist) {
      best = {
        id: String(e.id ?? ""),
        name: String(e.name ?? e.id ?? "Service"),
        type: norm(e.type),
        x: ex,
        z: ez,
        dist,
      };
    }
  }

  return best;
}

// ---- Step estimate (cardinal movement) ----
// We estimate minimum N/S/E/W steps needed to reach within radius R of target.
// This is L1 distance to a circle; computed by maximizing u+v on the circle.
function estimateStepsToRange(dx: number, dz: number, r: number): number {
  const a = Math.abs(dx);
  const b = Math.abs(dz);

  // Already in range (Euclidean)
  if (a * a + b * b <= r * r) return 0;

  // Maximize u+v subject to u^2+v^2<=r^2, 0<=u<=a, 0<=v<=b
  const R2 = r * r;
  let sMax = 0;

  // Candidate 1: unconstrained max on circle at (r/sqrt2, r/sqrt2)
  const u0 = r / Math.SQRT2;
  const v0 = r / Math.SQRT2;
  if (a >= u0 && b >= v0) sMax = Math.max(sMax, u0 + v0);

  // Candidate 2: u=a (if a<=r) and v = sqrt(r^2-a^2) (if <=b)
  if (a <= r) {
    const v = Math.sqrt(Math.max(0, R2 - a * a));
    if (v <= b) sMax = Math.max(sMax, a + v);
  }

  // Candidate 3: v=b (if b<=r) and u = sqrt(r^2-b^2) (if <=a)
  if (b <= r) {
    const u = Math.sqrt(Math.max(0, R2 - b * b));
    if (u <= a) sMax = Math.max(sMax, b + u);
  }

  // Fallback: if nothing above applied, use unconstrained (still safe)
  if (sMax <= 0) sMax = r * Math.SQRT2;

  const need = (a + b) - sMax;
  return Math.max(0, Math.ceil(need));
}

function moveHint(dx: number, dz: number): string {
  const parts: string[] = [];
  if (Math.abs(dx) >= 0.5) parts.push(dx > 0 ? "east" : "west");
  if (Math.abs(dz) >= 0.5) parts.push(dz > 0 ? "south" : "north");
  if (parts.length === 0) return "move closer";
  if (parts.length === 1) return `move ${parts[0]}`;
  return `move ${parts[0]} + ${parts[1]} (alternate for a diagonal)`;
}

function niceServiceName(service: ServiceName): string {
  return service === "guildbank"
    ? "Guild Bank"
    : service === "bank"
    ? "Bank"
    : service === "vendor"
    ? "Vendor"
    : service === "auction"
    ? "Auction House"
    : "Mail";
}

function denyNoAnchor(service: ServiceName): string {
  const nice = niceServiceName(service);
  return `${nice} isn't available here (no ${service} service anchor nearby).`;
}

function denyOutOfRange(service: ServiceName, anchor: AnchorMatch, steps: number, r: number, hint: string): string {
  const nice = niceServiceName(service);
  return `${nice} requires being within ${r} of a service anchor. Nearest is '${anchor.name}' at distance ${anchor.dist.toFixed(
    1
  )}. You're about ~${steps} step(s) away — ${hint}.`;
}

/**
 * Model B (anchor-based):
 * Service is available only if you are within serviceRadius(service) of the nearest service anchor.
 *
 * If PW_SERVICE_GATES_STRICT=0 (default):
 * - missing anchor falls back to town/safe_hub region rule.
 */
export async function requireTownService<T>(
  ctx: MudContext,
  char: CharacterState,
  service: ServiceName,
  run: () => Promise<T>
): Promise<T | string> {
  if (!serviceGatesEnabled()) return await run();
  if (isStaffBypass(ctx)) return await run();

  const { x: px, z: pz } = getPlayerXZ(ctx, char);
  const anchor = findNearestAnchor(ctx, char, service);
  const r = serviceRadius(service);

  if (anchor) {
    if (anchor.dist <= r) return await run();

    const dx = anchor.x - px;
    const dz = anchor.z - pz;
    const steps = estimateStepsToRange(dx, dz, r);
    return denyOutOfRange(service, anchor, steps, r, moveHint(dx, dz));
  }

  // No anchor found
  if (strictAnchors()) return denyNoAnchor(service);

  // Non-strict fallback (helps during early dev before anchors exist everywhere)
  if (isTownLike(ctx, px, pz)) return await run();
  return denyNoAnchor(service);
}
