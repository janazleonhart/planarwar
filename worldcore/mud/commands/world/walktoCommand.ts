// worldcore/mud/commands/world/walktoCommand.ts

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";
import { moveCharacterAndSync } from "../../../movement/moveOps";
import { parseMoveDir } from "../../../movement/MovementCommands";

type ServiceName = "bank" | "guildbank" | "vendor" | "auction" | "mail";

function envInt(name: string, fallback: number): number {
  const raw = (process.env[name] ?? "").toString().trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toArgArray(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") return v.trim().length ? v.trim().split(/\s+/) : [];
  return [];
}

function norm(s: any): string {
  return String(s ?? "").trim().toLowerCase();
}

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

function getEntitiesInRoom(ctx: MudContext, roomId: string): any[] {
  const ents = (ctx.entities as any)?.getEntitiesInRoom?.(roomId);
  return Array.isArray(ents) ? ents : [];
}

function normalizeHandleBase(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  return words[words.length - 1] ?? "entity";
}

function buildNearbyLikeTargets(ctx: MudContext, char: CharacterState, roomId: string) {
  const entities = getEntitiesInRoom(ctx, roomId);
  const self = (ctx.entities as any)?.getEntityByOwner?.(ctx.session.id) as any;
  const selfId = self?.id;

  const { x: originX, z: originZ } = getPlayerXZ(ctx, char);

  const others = (entities as any[]).filter((e) => e && e.id && e.id !== selfId);

  const withDist = others
    .map((e) => {
      const dx = (e.x ?? 0) - originX;
      const dz = (e.z ?? 0) - originZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      return { e, dist };
    })
    .sort((a, b) => {
      if (a.dist !== b.dist) return a.dist - b.dist;
      const an = String(a.e?.name ?? "").toLowerCase();
      const bn = String(b.e?.name ?? "").toLowerCase();
      if (an !== bn) return an.localeCompare(bn);
      return String(a.e?.id ?? "").localeCompare(String(b.e?.id ?? ""));
    });

  const shortCounts = new Map<string, number>();

  const targets = withDist.map(({ e, dist }) => {
    const hasSpawnPoint = typeof e?.spawnPointId === "number";
    const isPlayerLike = !!e?.ownerSessionId && !hasSpawnPoint;

    let kind: string;
    if (isPlayerLike) kind = "player";
    else if (e.type === "npc" || e.type === "mob") kind = "npc";
    else kind = e.type ?? "entity";

    const name = String(e.name ?? e.id);
    const base = normalizeHandleBase(name);
    const shortKey = `${kind}:${base}`;
    const n = (shortCounts.get(shortKey) ?? 0) + 1;
    shortCounts.set(shortKey, n);

    const hint = `${base}.${n}`;
    return { e, dist, kind, name, hint };
  });

  const byHint = new Map<string, any>();
  for (const t of targets) byHint.set(t.hint.toLowerCase(), t);

  return { targets, byHint };
}

function parseOptions(argv: string[]) {
  let radiusOverride: number | undefined;
  let maxStepsOverride: number | undefined;
  let stepDelayOverride: number | undefined;
  let allowInCombat = false;

  const keep: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === "--r" || a === "--radius") {
      const v = Number(argv[i + 1]);
      if (Number.isFinite(v)) radiusOverride = v;
      i++;
      continue;
    }

    if (a === "--max") {
      const v = Number(argv[i + 1]);
      if (Number.isFinite(v)) maxStepsOverride = Math.trunc(v);
      i++;
      continue;
    }

    if (a === "--delay") {
      const v = Number(argv[i + 1]);
      if (Number.isFinite(v)) stepDelayOverride = Math.trunc(v);
      i++;
      continue;
    }

    // Explicit “I know what I’m doing” flag (dev only). Default false.
    if (a === "--combat" || a === "--risk") {
      allowInCombat = true;
      continue;
    }

    keep.push(a);
  }

  return { radiusOverride, maxStepsOverride, stepDelayOverride, allowInCombat, keep };
}

function isServiceKeyword(s: string): ServiceName | null {
  const k = norm(s);
  if (k === "bank") return "bank";
  if (k === "gbank" || k === "guildbank") return "guildbank";
  if (k === "mail" || k === "mailbox") return "mail";
  if (k === "ah" || k === "auction" || k === "auctioneer") return "auction";
  if (k === "vendor" || k === "shop" || k === "merchant") return "vendor";
  return null;
}

function serviceRadius(service: ServiceName): number {
  const base = envInt("PW_SERVICE_RADIUS", 12);
  const per = envInt(`PW_SERVICE_RADIUS_${service.toUpperCase()}`, Number.NaN as any);
  return Number.isFinite(per) ? per : base;
}

function isServiceAnchorEntity(e: any, service: ServiceName): boolean {
  if (!e) return false;

  // exclude players
  const hasSpawnPoint = typeof e.spawnPointId === "number";
  const isPlayerLike = !!e.ownerSessionId && !hasSpawnPoint;
  if (isPlayerLike) return false;

  const t = norm(e.type);
  const tags = Array.isArray(e.tags) ? e.tags.map(norm) : [];
  const roles = Array.isArray(e.roles) ? e.roles.map(norm) : [];
  const svcKind = norm(e.serviceKind);

  const wantTag = service === "guildbank" ? "service_bank" : `service_${service}`;

  const typeMatches =
    (service === "mail" && (t === "mailbox" || t === "mail")) ||
    ((service === "bank" || service === "guildbank") && (t === "banker" || t === "bank")) ||
    (service === "auction" && (t === "auctioneer" || t === "auction")) ||
    (service === "vendor" && (t === "vendor" || t === "merchant"));

  const tagMatches =
    tags.includes(wantTag) ||
    (tags.includes("protected_service") && (tags.includes(wantTag) || svcKind === service));

  const roleMatches = roles.includes(wantTag) || roles.includes(service);

  const kindMatches = svcKind === service || (service === "guildbank" && svcKind === "bank");

  return !!(typeMatches || tagMatches || roleMatches || kindMatches);
}

function findNearestAnchor(ctx: MudContext, char: CharacterState, service: ServiceName) {
  const roomId = getRoomId(ctx, char);
  if (!roomId) return null;

  const { x: px, z: pz } = getPlayerXZ(ctx, char);
  const ents = getEntitiesInRoom(ctx, roomId);

  let best: { e: any; dist: number } | null = null;
  for (const e of ents) {
    if (!isServiceAnchorEntity(e, service)) continue;
    const ex = typeof e.x === "number" ? e.x : 0;
    const ez = typeof e.z === "number" ? e.z : 0;
    const dx = ex - px;
    const dz = ez - pz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (!best || dist < best.dist) best = { e, dist };
  }

  return best?.e ?? null;
}

function distanceXZ(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

function stepDirTowards(dx: number, dz: number, preferX: boolean): "n" | "s" | "e" | "w" {
  const ax = Math.abs(dx);
  const az = Math.abs(dz);

  if (preferX ? ax >= az : az > ax) {
    return dx > 0 ? "e" : "w";
  } else {
    return dz > 0 ? "s" : "n";
  }
}

/**
 * Best-effort combat detection without tightly coupling to CombatSystem internals.
 * We check multiple common signals; missing signals => assume not in combat.
 */
function isInCombat(ctx: MudContext, char: CharacterState): boolean {
  const ent = (ctx.entities as any)?.getEntityByOwner?.(ctx.session.id) as any;
  const combat: any = (ctx as any).combat;

  // CharacterState flags (if present)
  const s = (char as any)?.status;
  if (typeof s === "string" && s.toLowerCase().includes("combat")) return true;
  if ((char as any)?.inCombat === true) return true;

  // Entity flags (if present)
  if (ent?.inCombat === true) return true;
  if (typeof ent?.combatState === "string" && norm(ent.combatState).includes("combat")) return true;

  // Combat system API (if present)
  if (combat) {
    if (typeof combat.isInCombat === "function") {
      try {
        const id = ent?.id ?? (ctx.session as any)?.id;
        return !!combat.isInCombat(id);
      } catch {
        // ignore
      }
    }
    if (typeof combat.hasAggro === "function") {
      try {
        const id = ent?.id ?? (ctx.session as any)?.id;
        return !!combat.hasAggro(id);
      } catch {
        // ignore
      }
    }
  }

  return false;
}

export async function handleWalkToCommand(
  ctx: MudContext,
  char: CharacterState,
  input: { cmd: string; args: any; parts: any; world?: any }
): Promise<string> {
  const world = (input as any).world ?? (ctx as any).world;
  if (!world) return "The world is unavailable.";

  const argv0 = toArgArray(input?.args?.length ? input.args : input?.parts);
  const { radiusOverride, maxStepsOverride, stepDelayOverride, allowInCombat, keep } =
    parseOptions(argv0);

  const targetRaw = keep.join(" ").trim();
  if (!targetRaw) {
    return "Usage: walkto <bank|mail|auction|vendor|gbank|handle|name> [--radius N] [--max N] [--delay ms] [--risk]";
  }

  // Safety: by default, auto-walk cannot be used to “instant escape” combat.
  if (!allowInCombat && isInCombat(ctx, char)) {
    return "[walk] You can't auto-walk while in combat. (Use manual movement or finish the fight.)";
  }

  const roomId = getRoomId(ctx, char);
  if (!roomId) return "You are not in a room yet.";

  // Resolve target
  let target: any | null = null;
  let desiredRadius = radiusOverride ?? 3; // default for general entities
  const asService = isServiceKeyword(targetRaw);

  if (asService) {
    target = findNearestAnchor(ctx, char, asService);
    desiredRadius = radiusOverride ?? serviceRadius(asService);
    if (!target) {
      return `No ${asService} service anchor found nearby. (Try 'nearby' or hydrate town baselines.)`;
    }
  } else {
    const { targets, byHint } = buildNearbyLikeTargets(ctx, char, roomId);
    const key = targetRaw.toLowerCase().trim();

    if (/^\d+$/.test(key)) {
      const idx = Math.max(1, parseInt(key, 10)) - 1;
      target = targets[idx]?.e ?? null;
    } else if (byHint.has(key)) {
      target = byHint.get(key)?.e ?? null;
    } else {
      const want = key.replace(/[^a-z0-9 ]/g, "").trim();
      target = targets.find((t) => String(t.name).toLowerCase().includes(want))?.e ?? null;
    }

    if (!target) {
      return `Can't find '${targetRaw}' here. (Try 'nearby' and use the handle, like 'mailbox.1'.)`;
    }
  }

  const maxSteps = Math.max(1, maxStepsOverride ?? envInt("PW_WALKTO_MAX_STEPS", 128));

  // This is the “anti-exploit” throttle:
  // default 50ms/step so hostile territory can actually bite.
  const stepDelayMs = Math.max(0, stepDelayOverride ?? envInt("PW_WALKTO_STEP_DELAY_MS", 50));

  const tx = typeof target.x === "number" ? target.x : 0;
  const tz = typeof target.z === "number" ? target.z : 0;

  let moved = 0;
  let preferX = true;

  while (moved < maxSteps) {
    // Stop immediately if combat begins mid-walk (unless explicitly risked).
    if (!allowInCombat && isInCombat(ctx, char)) {
      const { x: px, z: pz } = getPlayerXZ(ctx, char);
      const remaining = distanceXZ(px, pz, tx, tz);
      return `[walk] Stopped: you were engaged in combat. (moved ${moved} step(s), remaining dist ~${remaining.toFixed(
        1
      )})`;
    }

    const { x: px, z: pz } = getPlayerXZ(ctx, char);
    const dist = distanceXZ(px, pz, tx, tz);
    if (dist <= desiredRadius) {
      const name = String(target.name ?? target.id ?? targetRaw);
      return `[walk] You arrive near ${name}. (${moved} step(s), dist ${dist.toFixed(1)} ≤ ${desiredRadius})`;
    }

    const dx = tx - px;
    const dz = tz - pz;
    const step = stepDirTowards(dx, dz, preferX);
    preferX = !preferX;

    const dir = parseMoveDir(step);
    if (!dir) return "[walk] Internal error: could not parse direction.";

    const res = await moveCharacterAndSync(ctx, char, dir, world, 1);
    if (!res.ok) {
      const remaining = distanceXZ(px, pz, tx, tz);
      return `[walk] Stopped after ${moved} step(s): ${res.reason} (remaining dist ~${remaining.toFixed(1)})`;
    }

    moved++;

    if (stepDelayMs > 0) {
      await sleep(stepDelayMs);
    }
  }

  const { x: fx, z: fz } = getPlayerXZ(ctx, char);
  const remaining = distanceXZ(fx, fz, tx, tz);
  return `[walk] Max steps reached (${maxSteps}). Remaining dist ~یشہ${remaining.toFixed(1)} (need ≤ ${desiredRadius}).`;
}
