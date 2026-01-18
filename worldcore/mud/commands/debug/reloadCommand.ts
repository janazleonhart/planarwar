// worldcore/mud/commands/debug/reloadCommand.ts

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";
import type { MudCommandInput } from "../types";

import {
  parseHotReloadTargets,
  runHotReload,
  formatHotReloadReport,
  type HotReloadDeps,
  type HotReloadTarget,
} from "../../../dev/HotReloadService";

import { NpcSpawnController } from "../../../npc/NpcSpawnController";

type ReconcileMode = "none" | "here" | "region";

function isNumberLike(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parseHereRadius(args: string[]): number | null {
  // Accept: --here, --here=60, --here 60
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a) continue;

    if (a === "--here") {
      const next = args[i + 1];
      const n = next != null ? Number(next) : NaN;
      return Number.isFinite(n) ? Math.max(1, n) : 60;
    }

    if (a.startsWith("--here=")) {
      const raw = a.slice("--here=".length);
      const n = Number(raw);
      return Number.isFinite(n) ? Math.max(1, n) : 60;
    }
  }
  return null;
}

function parseReconcileMode(args: string[]): { mode: ReconcileMode; hereRadius: number | null } {
  const hasRegion = args.includes("--region");
  const hereRadius = parseHereRadius(args);
  if (hasRegion) return { mode: "region", hereRadius: null };
  if (hereRadius != null) return { mode: "here", hereRadius };
  return { mode: "none", hereRadius: null };
}

function stripFlags(args: string[]): string[] {
  // Remove known flags so parseHotReloadTargets doesn't see them
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a) continue;

    if (a === "--region") continue;

    if (a === "--here") {
      // swallow optional numeric radius token
      const next = args[i + 1];
      if (next != null && Number.isFinite(Number(next))) i++;
      continue;
    }

    if (a.startsWith("--here=")) continue;

    out.push(a);
  }
  return out;
}

function resolveRoomShardRegion(
  ctx: MudContext,
  char: CharacterState,
): { roomId: string; shardId: string; regionId: string | null } {
  const roomId = (char as any)?.roomId ?? (ctx.session as any)?.roomId ?? "prime_room";
  const shardId = (char as any)?.shardId ?? (ctx.session as any)?.shardId ?? "prime_shard";
  const regionId =
    (char as any)?.lastRegionId ??
    (char as any)?.regionId ??
    (ctx.session as any)?.regionId ??
    null;

  return { roomId, shardId, regionId };
}

function resolveOwnerSessionId(ctx: MudContext, char: CharacterState): string | null {
  const sid =
    (ctx.session as any)?.id ??
    (ctx.session as any)?.sessionId ??
    (char as any)?.ownerSessionId ??
    (ctx.session as any)?.ownerSessionId ??
    null;

  return typeof sid === "string" && sid.trim() ? sid : null;
}

function getCharXZ(char: CharacterState): { x: number; z: number } {
  const x = Number((char as any)?.posX ?? (char as any)?.x ?? 0);
  const z = Number((char as any)?.posZ ?? (char as any)?.z ?? 0);
  return { x: Number.isFinite(x) ? x : 0, z: Number.isFinite(z) ? z : 0 };
}

function getEntityId(e: any): string | number | null {
  return e?.id ?? e?.entityId ?? null;
}

/**
 * For staleness checks:
 * - Only use immutable spawn coordinates when present.
 * - Never use live x/z because NPCs can move.
 */
function getEntitySpawnXZ(e: any): { x: number; z: number } | null {
  const sx = e?.spawnX;
  const sz = e?.spawnZ;
  const nx = Number(sx);
  const nz = Number(sz);
  if (!Number.isFinite(nx) || !Number.isFinite(nz)) return null;
  return { x: nx, z: nz };
}

/**
 * For scope checks (--here radius):
 * - Prefer spawn coords if present
 * - Otherwise fall back to live coords (x/z)
 *
 * This is safe because it ONLY decides whether an entity is "in the radius bucket",
 * not whether it is stale due to movement.
 */
function getEntityScopeXZ(e: any): { x: number; z: number } | null {
  const spawn = getEntitySpawnXZ(e);
  if (spawn) return spawn;

  const lx = Number(e?.x ?? e?.posX);
  const lz = Number(e?.z ?? e?.posZ);
  if (!Number.isFinite(lx) || !Number.isFinite(lz)) return null;
  return { x: lx, z: lz };
}

function isNpcPointType(p: any): boolean {
  const t = String(p?.type ?? "").toLowerCase();
  return t === "npc" || t === "mob" || t === "creature";
}

function isNodePointType(p: any): boolean {
  const t = String(p?.type ?? "").toLowerCase();
  return t === "node" || t === "resource";
}

function isSharedNpcEntity(e: any): boolean {
  if (!e) return false;

  if (!isNumberLike(e.spawnPointId)) return false;

  // Never touch personal/per-session entities
  if (e.ownerSessionId) return false;

  // Only NPC-ish types here
  const t = String(e.type ?? "").toLowerCase();
  if (t === "node" || t === "object") return false;

  return true;
}

function isPersonalNodeEntity(e: any, ownerSessionId: string): boolean {
  if (!e) return false;
  const t = String(e.type ?? "").toLowerCase();
  if (t !== "node" && t !== "object") return false;
  if (e.ownerSessionId !== ownerSessionId) return false;
  if (!isNumberLike(e.spawnPointId)) return false;
  return true;
}

function shouldRespawnEntityFromPoint(e: any, p: any): boolean {
  // Only treat coords as stale if immutable spawn coords exist.
  const ex = getEntitySpawnXZ(e);
  const px = Number(p?.x ?? 0);
  const pz = Number(p?.z ?? 0);

  const eps = 0.05;
  if (ex && (Math.abs(ex.x - px) > eps || Math.abs(ex.z - pz) > eps)) return true;

  // proto change -> rebuild
  const eProto = String(e?.protoId ?? "").trim();
  const pProto = String(p?.protoId ?? "").trim();
  if (eProto && pProto && eProto !== pProto) return true;

  // variant change -> rebuild
  const eVar = String(e?.variantId ?? "").trim();
  const pVar = String(p?.variantId ?? "").trim();
  if (eVar && pVar && eVar !== pVar) return true;

  return false;
}

async function safeDespawnEntity(ctx: MudContext, entityId: any): Promise<boolean> {
  if (entityId == null) return false;

  const npcs: any = (ctx as any).npcs;
  if (npcs?.despawnNpc) {
    npcs.despawnNpc(entityId);
    return true;
  }

  const entities: any = (ctx as any).entities;
  if (entities?.removeEntity) {
    entities.removeEntity(String(entityId));
    return true;
  }

  return false;
}

/**
 * reload [targets...] [--here[=radius]] [--region]
 *
 * Behavior:
 * - spawns:
 *    - clears SpawnPointCache (via HotReloadService)
 *    - force rehydrates POIs for current room/region (SpawnHydrator)
 * - --here/--region:
 *    - reconciles shared NPC spawns for the given scope (despawn stale, respawn missing)
 *    - MUST NOT touch personal nodes/resources
 * - plain `reload spawns` (no flags):
 *    - additionally reconciles personal nodes for THIS session + current region
 */
export async function handleReloadCommand(
  ctx: MudContext,
  char: CharacterState,
  input: MudCommandInput,
): Promise<string> {
  const rawArgs = input.args ?? [];
  const { mode, hereRadius } = parseReconcileMode(rawArgs);

  const argsSansFlags = stripFlags(rawArgs);
  let targets = parseHotReloadTargets(argsSansFlags);

  if (!targets.length) targets = ["all"];

  // If user asked for reconcile mode without specifying spawns,
  // they obviously intend spawn refresh.
  if (mode !== "none" && !targets.includes("all") && !targets.includes("spawns")) {
    targets = [...targets, "spawns"];
  }

  const { roomId, shardId, regionId } = resolveRoomShardRegion(ctx, char);

  const deps: HotReloadDeps = {
    items: ctx.items,
    spawnPoints: (ctx.npcSpawns as any)?.deps?.spawnPoints,
  } satisfies HotReloadDeps;

  const report = await runHotReload(targets, deps);
  let out = formatHotReloadReport(report);

  const wantSpawns = targets.includes("all") || (targets as HotReloadTarget[]).includes("spawns");

  // ---------------------------------------------------------------------------
  // 1) POI hydration
  // ---------------------------------------------------------------------------
  if (wantSpawns && ctx.spawnHydrator?.rehydrateRoom && regionId) {
    try {
      const res = await ctx.spawnHydrator.rehydrateRoom({
        shardId,
        regionId,
        roomId,
        force: true,
      } as any);

      out += `\n[reload] rehydrate: spawned=${res.spawned ?? 0} skippedExisting=${
        res.skippedExisting ?? 0
      } eligible=${res.eligible ?? 0} total=${res.total ?? 0}`;
    } catch (err: any) {
      out += `\n[reload] rehydrate: failed (${String(err?.message ?? err)})`;
    }
  } else if (wantSpawns && !regionId) {
    out += `\n[reload] rehydrate: skipped (no regionId available)`;
  }

  // ---------------------------------------------------------------------------
  // 2) Personal nodes reconcile (ONLY on plain reload, no flags)
  // ---------------------------------------------------------------------------
  if (wantSpawns && mode === "none") {
    const spawnService: any =
      (ctx.npcSpawns as any)?.deps?.spawnPoints ?? (deps as any).spawnPoints ?? null;

    const ownerSessionId = resolveOwnerSessionId(ctx, char);

    if (!spawnService || !ctx.entities || !ctx.npcs) {
      out += `\n[reload] personalNodes: skipped (missing spawnPoints/entities/npcs)`;
    } else if (!regionId) {
      out += `\n[reload] personalNodes: skipped (no regionId available)`;
    } else if (!ownerSessionId) {
      out += `\n[reload] personalNodes: skipped (no ownerSessionId available)`;
    } else {
      const controller =
        (ctx.npcSpawns as any) ??
        new NpcSpawnController({
          spawnPoints: spawnService,
          npcs: ctx.npcs as any,
          entities: ctx.entities as any,
        });

      try {
        const points = await spawnService.getSpawnPointsForRegion(shardId, regionId);

        const desiredNodes = new Map<number, any>();
        for (const p of points ?? []) {
          const id = Number(p?.id);
          if (!Number.isFinite(id)) continue;
          if (!isNodePointType(p)) continue;
          desiredNodes.set(id, p);
        }

        let despawned = 0;
        const ents: any[] = (ctx.entities as any).getEntitiesInRoom?.(roomId) ?? [];
        for (const e of ents) {
          if (!isPersonalNodeEntity(e, ownerSessionId)) continue;

          const spid = Number(e.spawnPointId);
          const desired = desiredNodes.get(spid);

          if (!desired) {
            const eid = getEntityId(e);
            if (await safeDespawnEntity(ctx, eid)) despawned++;
            continue;
          }

          if (shouldRespawnEntityFromPoint(e, desired)) {
            const eid = getEntityId(e);
            if (await safeDespawnEntity(ctx, eid)) despawned++;
            continue;
          }
        }

        const spawned =
          typeof (controller as any).spawnPersonalNodesForRegion === "function"
            ? await (controller as any).spawnPersonalNodesForRegion(
                shardId,
                regionId,
                roomId,
                ownerSessionId,
                char,
              )
            : typeof (controller as any).spawnPersonalNodesFromRegion === "function"
              ? await (controller as any).spawnPersonalNodesFromRegion(
                  shardId,
                  regionId,
                  roomId,
                  ownerSessionId,
                  char,
                )
              : 0;

        out += `\n[reload] personalNodes(region): desired=${desiredNodes.size} despawned=${despawned} spawned=${spawned}`;
      } catch (err: any) {
        out += `\n[reload] personalNodes(region): failed (${String(err?.message ?? err)})`;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 3) Shared NPC reconcile: --here / --region
  // ---------------------------------------------------------------------------
  if (wantSpawns && mode !== "none") {
    const spawnService: any =
      (ctx.npcSpawns as any)?.deps?.spawnPoints ?? (deps as any).spawnPoints ?? null;

    if (!spawnService || !ctx.entities || !ctx.npcs) {
      out += `\n[reload] reconcile: skipped (missing spawnPoints/entities/npcs)`;
      return out;
    }

    if (!regionId) {
      out += `\n[reload] reconcile: skipped (no regionId available)`;
      return out;
    }

    const controller =
      (ctx.npcSpawns as any) ??
      new NpcSpawnController({
        spawnPoints: spawnService,
        npcs: ctx.npcs as any,
        entities: ctx.entities as any,
      });

    try {
      const { x, z } = getCharXZ(char);
      const radius = mode === "here" ? (hereRadius ?? 60) : 0;

      const points =
        mode === "region"
          ? await spawnService.getSpawnPointsForRegion(shardId, regionId)
          : await spawnService.getSpawnPointsNear(shardId, x, z, radius);

      const desiredNpcById = new Map<number, any>();
      for (const p of points ?? []) {
        if (!isNpcPointType(p)) continue;
        const id = Number(p.id);
        if (Number.isFinite(id)) desiredNpcById.set(id, p);
      }

      let despawned = 0;
      const ents: any[] = (ctx.entities as any).getEntitiesInRoom?.(roomId) ?? [];
      for (const e of ents) {
        if (!isSharedNpcEntity(e)) continue;

        if (e.regionId && String(e.regionId) !== String(regionId)) continue;

        // Scope gate for --here: use spawn coords if present, else live coords.
        if (mode === "here") {
          const pos = getEntityScopeXZ(e);
          if (!pos) continue;
          const dx = pos.x - x;
          const dz = pos.z - z;
          if (dx * dx + dz * dz > radius * radius) continue;
        }

        const spid = Number(e.spawnPointId);
        if (!Number.isFinite(spid)) continue;

        const desired = desiredNpcById.get(spid);
        if (!desired) {
          const eid = getEntityId(e);
          if (await safeDespawnEntity(ctx, eid)) despawned++;
          continue;
        }

        if (shouldRespawnEntityFromPoint(e, desired)) {
          const eid = getEntityId(e);
          if (await safeDespawnEntity(ctx, eid)) despawned++;
          continue;
        }
      }

      const spawned =
        mode === "region"
          ? await (controller as any).spawnFromRegion(shardId, regionId, roomId)
          : await (controller as any).spawnNear(shardId, x, z, radius, roomId);

      out += `\n[reload] reconcile(${mode}): desired=${desiredNpcById.size} despawned=${despawned} spawned=${spawned}`;
    } catch (err: any) {
      out += `\n[reload] reconcile(${mode}): failed (${String(err?.message ?? err)})`;
    }
  }

  return out;
}
