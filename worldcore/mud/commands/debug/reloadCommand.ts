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

function resolveRoomShardRegion(ctx: MudContext, char: CharacterState): {
  roomId: string;
  shardId: string;
  regionId: string | null;
} {
  // Keep these fallbacks permissive. Worst case: no region => we skip hydration/reconcile.
  const roomId =
    (char as any)?.roomId ??
    (ctx.session as any)?.roomId ??
    "prime_room";

  const shardId =
    (char as any)?.shardId ??
    (ctx.session as any)?.shardId ??
    "prime_shard";

  const regionId =
    (char as any)?.lastRegionId ??
    (char as any)?.regionId ??
    (ctx.session as any)?.regionId ??
    null;

  return { roomId, shardId, regionId };
}

function getCharXZ(char: CharacterState): { x: number; z: number } {
  const x = Number((char as any)?.posX ?? (char as any)?.x ?? 0);
  const z = Number((char as any)?.posZ ?? (char as any)?.z ?? 0);
  return { x: Number.isFinite(x) ? x : 0, z: Number.isFinite(z) ? z : 0 };
}

function getEntityId(e: any): string | number | null {
  return e?.id ?? e?.entityId ?? null;
}

function getEntityXZ(e: any): { x: number; z: number } | null {
  const x = e?.x ?? e?.posX ?? e?.spawnX;
  const z = e?.z ?? e?.posZ ?? e?.spawnZ;
  const nx = Number(x);
  const nz = Number(z);
  if (!Number.isFinite(nx) || !Number.isFinite(nz)) return null;
  return { x: nx, z: nz };
}

function isSharedNpcEntity(e: any): boolean {
  if (!e) return false;

  // Must be spawn_points-driven
  if (!isNumberLike(e.spawnPointId)) return false;

  // Never touch personal nodes
  if (e.ownerSessionId) return false;

  // Never touch nodes/objects explicitly
  const t = String(e.type ?? "").toLowerCase();
  if (t === "node" || t === "object") return false;

  // Conservatively treat anything else as "NPC-ish"
  return true;
}

function isNpcPointType(p: any): boolean {
  const t = String(p?.type ?? "").toLowerCase();
  return t === "npc" || t === "mob" || t === "creature";
}

/**
 * reload [targets...] [--here[=radius]] [--region]
 *
 * Examples:
 *   reload
 *   reload spawns
 *   reload spawns --here
 *   reload spawns --here=80
 *   reload spawns --region
 *   reload --region            (implies spawns)
 *
 * Behavior:
 * - Best-effort: if loaders are not provided, HotReloadService warns + skips.
 * - spawns always: clears SpawnPointCache, then force rehydrates POIs for current room/region.
 * - --here: additionally reconciles shared NPC spawns near the player (radius) in the current room.
 * - --region: additionally reconciles shared NPC spawns for the whole current region.
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

  // Preserve the "reload = all" UX
  if (!targets.length) targets = ["all"];

  // If user asked for reconcile mode without specifying spawns,
  // they obviously intend spawn refresh.
  if (mode !== "none" && !targets.includes("all") && !targets.includes("spawns")) {
    targets = [...targets, "spawns"];
  }

  const { roomId, shardId, regionId } = resolveRoomShardRegion(ctx, char);

  // HotReloadService expects a strict deps bag. Only pass fields that exist in HotReloadDeps.
  const deps: HotReloadDeps = {
    items: ctx.items,
    spawnPoints: (ctx.npcSpawns as any)?.deps?.spawnPoints,
    // questLoader: <wire later>,
    // npcLoader: <wire later>,
  } satisfies HotReloadDeps;

  const report = await runHotReload(targets, deps);
  let out = formatHotReloadReport(report);

  const wantSpawns =
    targets.includes("all") || (targets as HotReloadTarget[]).includes("spawns");

  // ---------------------------------------------------------------------------
  // 1) POI hydration: make spawn_points changes visible immediately (stations/mailbox/etc)
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
  // 2) Optional NPC reconcile: --here / --region
  // ---------------------------------------------------------------------------
  if (wantSpawns && mode !== "none") {
    // We need runtime services to safely reconcile
    const spawnService: any = (ctx.npcSpawns as any)?.deps?.spawnPoints ?? (deps as any).spawnPoints;
    if (!spawnService || !ctx.entities || !ctx.npcs) {
      out += `\n[reload] reconcile: skipped (missing spawnPoints/entities/npcs)`;
      return out;
    }

    if (!regionId) {
      out += `\n[reload] reconcile: skipped (no regionId available)`;
      return out;
    }

    const controller =
      ctx.npcSpawns ??
      new NpcSpawnController({
        spawnPoints: spawnService,
        npcs: ctx.npcs,
        entities: ctx.entities,
      });

    try {
      const { x, z } = getCharXZ(char);
      const radius = mode === "here" ? (hereRadius ?? 60) : 0;

      // Build the desired set of shared-NPC spawnPointIds for scope
      const points =
        mode === "region"
          ? await spawnService.getSpawnPointsForRegion(shardId, regionId)
          : await spawnService.getSpawnPointsNear(shardId, x, z, radius);

      const desiredNpcIds = new Set<number>();
      for (const p of points ?? []) {
        if (!isNpcPointType(p)) continue;
        const id = Number(p.id);
        if (Number.isFinite(id)) desiredNpcIds.add(id);
      }

      // Despawn stale shared NPC entities in scope (SAFE FILTERS)
      let despawned = 0;
      const ents: any[] = (ctx.entities as any).getEntitiesInRoom?.(roomId) ?? [];
      for (const e of ents) {
        if (!isSharedNpcEntity(e)) continue;

        // Scope gate: region must match if present
        if (e.regionId && String(e.regionId) !== String(regionId)) continue;

        // Scope gate for --here: only within radius (if we can compute coords)
        if (mode === "here") {
          const pos = getEntityXZ(e);
          if (!pos) continue; // can't safely compute, so skip
          const dx = pos.x - x;
          const dz = pos.z - z;
          if (dx * dx + dz * dz > radius * radius) continue;
        }

        const spid = Number(e.spawnPointId);
        if (!Number.isFinite(spid)) continue;

        if (!desiredNpcIds.has(spid)) {
          const eid = getEntityId(e);
          if (eid == null) continue;
          (ctx.npcs as any).despawnNpc?.(eid);
          despawned++;
        }
      }

      // Spawn missing shared NPCs for scope (controller dedupes against live entities)
      const spawned =
        mode === "region"
          ? await controller.spawnFromRegion(shardId, regionId, roomId)
          : await controller.spawnNear(shardId, x, z, radius, roomId);

      out += `\n[reload] reconcile(${mode}): desired=${desiredNpcIds.size} despawned=${despawned} spawned=${spawned}`;
    } catch (err: any) {
      out += `\n[reload] reconcile(${mode}): failed (${String(err?.message ?? err)})`;
    }
  }

  return out;
}
