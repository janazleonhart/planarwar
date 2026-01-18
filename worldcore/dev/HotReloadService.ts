// worldcore/dev/HotReloadService.ts

import { Logger } from "../utils/logger";
import { setQuestDefinitions } from "../quests/QuestRegistry";
import { setNpcPrototypes } from "../npc/NpcTypes";

export type HotReloadTarget = "all" | "items" | "quests" | "npcs" | "spawns";

export interface HotReloadSpawnContext {
  shardId: string;
  regionId: string;
  roomId: string;

  // Optional: enables personal node respawn pass
  ownerSessionId?: string;
  char?: any;
}

export interface HotReloadDeps {
  // Items
  items?: any;

  // Quests / NPC prototypes (optional loaders)
  questLoader?: { listQuests(): Promise<any[]> };
  npcLoader?: { listNpcs(): Promise<any[]> };

  // Spawn-point service (optional, used for best-effort cache invalidation)
  spawnPoints?: any;

  // Optional: if provided, spawns reload can do more than clear caches:
  // - force POI rehydrate
  // - respawn spawn_points-driven NPCs
  // - refresh personal nodes
  spawnHydrator?: {
    rehydrateRoom(args: {
      shardId: string;
      regionId: string;
      roomId: string;
      dryRun?: boolean;
      force?: boolean;
    }): Promise<{ spawned?: number; wouldSpawn?: number; eligible?: number; total?: number }>;
  };

  npcSpawns?: {
    spawnFromRegion(shardId: string, regionId: string, roomId: string): Promise<number>;
    spawnPersonalNodesForRegion(
      shardId: string,
      regionId: string,
      roomId: string,
      ownerSessionId: string,
      char: any,
    ): Promise<number>;
  };

  spawnContexts?: HotReloadSpawnContext[];
}

export interface HotReloadReport {
  ok: boolean;
  requested: HotReloadTarget[];
  durationMs: number;

  reloaded: {
    items?: { ok: boolean; count?: number };
    quests?: { ok: boolean; count?: number };
    npcs?: { ok: boolean; count?: number };
    spawns?: {
      ok: boolean;

      spawnPointCacheCleared: boolean;
      serviceCacheCleared: boolean;

      // Optional “active refresh” results (only if deps were provided)
      rehydratedPoi?: number;
      spawnedSharedNpcs?: number;
      spawnedPersonalNodes?: number;
    };
  };

  warnings: string[];
  errors: string[];
}

const log = Logger.scope("HotReload");

function uniqTargets(targets: HotReloadTarget[]): HotReloadTarget[] {
  const set = new Set<HotReloadTarget>();
  for (const t of targets) set.add(t);
  return [...set];
}

/**
 * Accepts:
 *  reload
 *  reload all
 *  reload items
 *  reload spawns
 *  reload spawn_points
 *  reload items spawns
 */
export function parseHotReloadTargets(args: string[]): HotReloadTarget[] {
  const raw = (args ?? []).map((s) => String(s ?? "").trim().toLowerCase()).filter(Boolean);
  if (raw.length === 0) return ["all"];

  const out: HotReloadTarget[] = [];
  for (const tok of raw) {
    if (tok === "all") out.push("all");
    else if (tok === "item" || tok === "items") out.push("items");
    else if (tok === "quest" || tok === "quests") out.push("quests");
    else if (tok === "npc" || tok === "npcs") out.push("npcs");
    else if (tok === "spawn" || tok === "spawns" || tok === "spawn_points" || tok === "spawnpoints") out.push("spawns");
  }

  if (out.length === 0) return ["all"];
  return uniqTargets(out);
}

async function maybeClearSpawnPointCache(warnings: string[]): Promise<boolean> {
  // SpawnPointCache is a module-level singleton style cache.
  // We avoid direct import cycles by dynamic importing and duck-typing.
  try {
    const mod: any = await import("../world/SpawnPointCache");
    const cache = mod?.SPAWN_POINT_CACHE ?? mod?.SpawnPointCache ?? mod?.default;
    if (!cache) {
      warnings.push("SpawnPointCache module loaded but no cache instance found.");
      return false;
    }

    if (typeof cache.clear === "function") {
      cache.clear();
      return true;
    }

    if (typeof cache.invalidateAll === "function") {
      cache.invalidateAll();
      return true;
    }

    warnings.push("SpawnPointCache found but has no clear()/invalidateAll().");
    return false;
  } catch (err: any) {
    warnings.push(`SpawnPointCache clear failed: ${String(err?.message ?? err)}`);
    return false;
  }
}

function maybeClearSpawnPointServiceCache(spawnPoints: any, warnings: string[]): boolean {
  // If caller provided SpawnPointService instance, try to clear its internal memoization.
  // Also try static module-level cache patterns by duck typing if present.
  try {
    const svc = spawnPoints;
    if (!svc) return false;

    if (typeof svc.clearCache === "function") {
      svc.clearCache();
      return true;
    }

    if (typeof svc.invalidateAll === "function") {
      svc.invalidateAll();
      return true;
    }

    if (typeof svc.reset === "function") {
      svc.reset();
      return true;
    }

    // No known cache API; not fatal.
    warnings.push("SpawnPointService provided but has no clearCache()/invalidateAll()/reset().");
    return false;
  } catch (err: any) {
    warnings.push(`SpawnPointService cache clear failed: ${String(err?.message ?? err)}`);
    return false;
  }
}

async function maybeReloadItems(items: any): Promise<number> {
  // Prefer explicit reload(), then loadAll() fallback.
  if (!items) throw new Error("No ItemService provided");
  if (typeof items.reload === "function") {
    await items.reload();
    // Best-effort count
    if (typeof items.count === "function") return Number(items.count());
    if (typeof items.size === "number") return Number(items.size);
    return 0;
  }
  if (typeof items.loadAll === "function") {
    await items.loadAll();
    if (typeof items.count === "function") return Number(items.count());
    if (typeof items.size === "number") return Number(items.size);
    return 0;
  }
  throw new Error("ItemService has no reload()/loadAll()");
}

function wantFn(targets: HotReloadTarget[]) {
  const hasAll = targets.includes("all");
  return (t: Exclude<HotReloadTarget, "all">) => hasAll || targets.includes(t);
}

/**
 * Run hot reload.
 *
 * IMPORTANT:
 * - This is deliberately “best effort.” We collect warnings/errors and keep going.
 * - Spawn reload can be “cache-only” OR “cache + active refresh” if deps provide contexts + services.
 */
export async function runHotReload(
  targets: HotReloadTarget[],
  deps: HotReloadDeps,
): Promise<HotReloadReport> {
  const started = Date.now();
  const want = wantFn(targets);

  const warnings: string[] = [];
  const errors: string[] = [];

  const report: HotReloadReport = {
    ok: true,
    requested: uniqTargets(targets.length ? targets : ["all"]),
    durationMs: 0,
    reloaded: {},
    warnings,
    errors,
  };

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------
  if (want("items")) {
    if (!deps.items) {
      warnings.push("No ItemService provided; items not reloaded.");
      report.reloaded.items = { ok: false };
    } else {
      try {
        const count = await maybeReloadItems(deps.items);
        report.reloaded.items = { ok: true, count };
      } catch (err: any) {
        report.ok = false;
        errors.push(`Item reload failed: ${String(err?.message ?? err)}`);
        report.reloaded.items = { ok: false };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Quests
  // ---------------------------------------------------------------------------
  if (want("quests")) {
    if (!deps.questLoader) {
      warnings.push("No questLoader provided; quests not reloaded.");
      report.reloaded.quests = { ok: false };
    } else {
      try {
        const defs = await deps.questLoader.listQuests();
        setQuestDefinitions(defs);
        report.reloaded.quests = { ok: true, count: defs.length };
      } catch (err: any) {
        report.ok = false;
        errors.push(`Quest reload failed: ${String(err?.message ?? err)}`);
        report.reloaded.quests = { ok: false };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // NPCs
  // ---------------------------------------------------------------------------
  if (want("npcs")) {
    if (!deps.npcLoader) {
      warnings.push("No npcLoader provided; NPC prototypes not reloaded.");
      report.reloaded.npcs = { ok: false };
    } else {
      try {
        const protos = await deps.npcLoader.listNpcs();
        setNpcPrototypes(protos);
        report.reloaded.npcs = { ok: true, count: protos.length };
      } catch (err: any) {
        report.ok = false;
        errors.push(`NPC reload failed: ${String(err?.message ?? err)}`);
        report.reloaded.npcs = { ok: false };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Spawns (cache clear + optional active refresh)
  // ---------------------------------------------------------------------------
  if (want("spawns")) {
    const spawnPointCacheCleared = await maybeClearSpawnPointCache(warnings);
    const serviceCacheCleared = maybeClearSpawnPointServiceCache(deps.spawnPoints, warnings);

    let rehydratedPoi = 0;
    let spawnedSharedNpcs = 0;
    let spawnedPersonalNodes = 0;

    const contexts = (deps.spawnContexts ?? []).filter((c) => c && c.shardId && c.regionId && c.roomId);

    // Optional “active refresh”:
    // - Force SpawnHydrator rehydrate for the active room/region contexts.
    // - Force NpcSpawnController to spawn shared NPCs from spawn_points.
    // - Optionally refresh personal nodes when ownerSessionId+char are available.
    if (contexts.length > 0) {
      if (deps.spawnHydrator && typeof deps.spawnHydrator.rehydrateRoom === "function") {
        for (const c of contexts) {
          try {
            const r = await deps.spawnHydrator.rehydrateRoom({
              shardId: c.shardId,
              regionId: c.regionId,
              roomId: c.roomId,
              dryRun: false,
              force: true,
            });
            rehydratedPoi += Number(r?.spawned ?? 0);
          } catch (err: any) {
            report.ok = false;
            errors.push(`Spawn rehydrate failed (${c.regionId}): ${String(err?.message ?? err)}`);
          }
        }
      } else {
        warnings.push("No spawnHydrator provided; spawn reload did not rehydrate POIs.");
      }

      if (deps.npcSpawns && typeof deps.npcSpawns.spawnFromRegion === "function") {
        for (const c of contexts) {
          try {
            spawnedSharedNpcs += Number(await deps.npcSpawns.spawnFromRegion(c.shardId, c.regionId, c.roomId));
          } catch (err: any) {
            report.ok = false;
            errors.push(`NPC spawn refresh failed (${c.regionId}): ${String(err?.message ?? err)}`);
          }

          // Personal nodes are optional and require both an ownerSessionId and a char surface.
          if (
            c.ownerSessionId &&
            c.char &&
            typeof deps.npcSpawns.spawnPersonalNodesForRegion === "function"
          ) {
            try {
              spawnedPersonalNodes += Number(
                await deps.npcSpawns.spawnPersonalNodesForRegion(
                  c.shardId,
                  c.regionId,
                  c.roomId,
                  c.ownerSessionId,
                  c.char,
                ),
              );
            } catch (err: any) {
              report.ok = false;
              errors.push(`Personal node refresh failed (${c.regionId}): ${String(err?.message ?? err)}`);
            }
          }
        }
      } else {
        warnings.push("No npcSpawns provided; spawn reload did not respawn spawn_points-driven NPCs.");
      }
    } else {
      warnings.push("No spawnContexts provided; spawn reload only cleared caches.");
    }

    report.reloaded.spawns = {
      ok: true,
      spawnPointCacheCleared,
      serviceCacheCleared,
      rehydratedPoi: rehydratedPoi || undefined,
      spawnedSharedNpcs: spawnedSharedNpcs || undefined,
      spawnedPersonalNodes: spawnedPersonalNodes || undefined,
    };
  }

  report.durationMs = Date.now() - started;

  log.info("Hot reload finished", {
    ok: report.ok,
    requested: report.requested,
    durationMs: report.durationMs,
    reloaded: report.reloaded,
    warnings: report.warnings.length,
    errors: report.errors.length,
  });

  return report;
}

export function formatHotReloadReport(r: HotReloadReport): string {
  const lines: string[] = [];
  lines.push(`[reload] ok=${r.ok} targets=${r.requested.join(",")} (${r.durationMs}ms)`);

  if (r.reloaded.items) {
    lines.push(
      `[reload] items: ${r.reloaded.items.ok ? "ok" : "fail"}${
        typeof r.reloaded.items.count === "number" ? ` (count=${r.reloaded.items.count})` : ""
      }`,
    );
  }

  if (r.reloaded.quests) {
    lines.push(
      `[reload] quests: ${r.reloaded.quests.ok ? "ok" : "fail"}${
        typeof r.reloaded.quests.count === "number" ? ` (count=${r.reloaded.quests.count})` : ""
      }`,
    );
  }

  if (r.reloaded.npcs) {
    lines.push(
      `[reload] npcs: ${r.reloaded.npcs.ok ? "ok" : "fail"}${
        typeof r.reloaded.npcs.count === "number" ? ` (count=${r.reloaded.npcs.count})` : ""
      }`,
    );
  }

  if (r.reloaded.spawns) {
    const extra: string[] = [];
    if (typeof r.reloaded.spawns.rehydratedPoi === "number") extra.push(`rehydratedPoi=${r.reloaded.spawns.rehydratedPoi}`);
    if (typeof r.reloaded.spawns.spawnedSharedNpcs === "number") extra.push(`spawnedSharedNpcs=${r.reloaded.spawns.spawnedSharedNpcs}`);
    if (typeof r.reloaded.spawns.spawnedPersonalNodes === "number") extra.push(`spawnedPersonalNodes=${r.reloaded.spawns.spawnedPersonalNodes}`);

    lines.push(
      `[reload] spawns: ok (SpawnPointCache=${r.reloaded.spawns.spawnPointCacheCleared ? "cleared" : "no-op"}, SpawnPointService=${r.reloaded.spawns.serviceCacheCleared ? "cleared" : "no-op"}${
        extra.length ? `, ${extra.join(", ")}` : ""
      })`,
    );
  }

  if (r.errors.length > 0) {
    lines.push(`[reload] errors:`);
    for (const e of r.errors) lines.push(`- ${e}`);
  }

  if (r.warnings.length > 0) {
    lines.push(`[reload] warnings:`);
    for (const w of r.warnings) lines.push(`- ${w}`);
  }

  return lines.join("\n");
}
