// worldcore/dev/HotReloadService.ts

import { Logger } from "../utils/logger";

const log = Logger.scope("HotReload");

export type HotReloadTarget = "all" | "items" | "quests" | "npcs" | "spawns";

export interface HotReloadDeps {
  items?: any;
  quests?: any;

  // Optional loaders / registries
  questLoader?: any; // expects loadAll() => quest defs OR reload()
  npcLoader?: any; // expects loadAll() => npc protos OR reload()

  // Spawn systems (optional)
  spawnPoints?: any; // SpawnPointService (may have caches)
}

export interface HotReloadReport {
  requested: HotReloadTarget[];
  ok: boolean;
  durationMs: number;

  reloaded: {
    items: { ok: boolean; count?: number; error?: string | null };
    quests: { ok: boolean; count?: number; error?: string | null };
    npcs: { ok: boolean; count?: number; error?: string | null };
    spawns: {
      ok: boolean;
      spawnPointCacheCleared: boolean;
      serviceCacheCleared: boolean;
      error?: string | null;
    };
  };

  warnings: string[];
  errors: string[];
}

function uniqTargets(targets: HotReloadTarget[]): HotReloadTarget[] {
  const set = new Set<HotReloadTarget>();
  for (const t of targets) set.add(t);
  return Array.from(set);
}

export function parseHotReloadTargets(args: string[]): HotReloadTarget[] {
  const raw = (args ?? []).flatMap((a) => String(a ?? "").split(/[,\s]+/g));
  const tokens = raw.map((t) => t.trim().toLowerCase()).filter(Boolean);

  if (tokens.length === 0) return ["all"];

  const out: HotReloadTarget[] = [];
  for (const t of tokens) {
    if (t === "all" || t === "*") out.push("all");
    else if (t === "item" || t === "items") out.push("items");
    else if (t === "quest" || t === "quests") out.push("quests");
    else if (t === "npc" || t === "npcs") out.push("npcs");
    else if (
      t === "spawn" ||
      t === "spawns" ||
      t === "spawn_points" ||
      t === "spawnpoints"
    )
      out.push("spawns");
    else {
      // Unknown token ignored (soft)
    }
  }

  if (out.length === 0) return ["all"];
  return uniqTargets(out);
}

async function maybeClearSpawnPointCache(warnings: string[]): Promise<boolean> {
  // If SpawnPointCache is present, prefer the exported clear helper.
  // This avoids reaching into private module state.
  try {
    const mod: any = await import("../world/SpawnPointCache");
    const candidates = [
      mod.clearSpawnPointCache,
      mod.resetSpawnPointCache,
      mod.clearCache,
      mod.resetCache,
    ].filter((f) => typeof f === "function") as Array<() => void>;

    if (candidates.length === 0) {
      warnings.push(
        "SpawnPointCache module loaded but no clear/reset function was found.",
      );
      return false;
    }

    // Call the first available.
    candidates[0]();
    return true;
  } catch (err: any) {
    warnings.push(
      `SpawnPointCache not available to clear (import failed): ${String(
        err?.message ?? err,
      )}`,
    );
    return false;
  }
}

function maybeClearSpawnPointServiceCaches(
  spawnPoints: any,
  warnings: string[],
): boolean {
  if (!spawnPoints) return false;

  // Duck-typed cache invalidation patterns
  const fns = [
    "clearCache",
    "clearCaches",
    "resetCache",
    "resetCaches",
    "invalidateAll",
    "invalidateCache",
  ];

  for (const name of fns) {
    const fn = (spawnPoints as any)[name];
    if (typeof fn === "function") {
      try {
        fn.call(spawnPoints);
        return true;
      } catch (err: any) {
        warnings.push(
          `SpawnPointService.${name}() threw: ${String(err?.message ?? err)}`,
        );
        return false;
      }
    }
  }

  // Not an error; many services are thin DB facades with no cache.
  return false;
}

export async function runHotReload(
  targets: HotReloadTarget[],
  deps: HotReloadDeps,
): Promise<HotReloadReport> {
  const started = Date.now();
  const requested = uniqTargets(targets.length ? targets : ["all"]);

  const want = (t: Exclude<HotReloadTarget, "all">) =>
    requested.includes("all") || requested.includes(t);

  const warnings: string[] = [];
  const errors: string[] = [];

  const report: HotReloadReport = {
    requested,
    ok: true,
    durationMs: 0,
    reloaded: {
      items: { ok: true, count: 0, error: null },
      quests: { ok: true, count: 0, error: null },
      npcs: { ok: true, count: 0, error: null },
      spawns: {
        ok: true,
        spawnPointCacheCleared: false,
        serviceCacheCleared: false,
        error: null,
      },
    },
    warnings,
    errors,
  };

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------
  if (want("items")) {
    try {
      const svc: any = deps.items;
      if (!svc) {
        warnings.push("No ItemService provided; items not reloaded.");
      } else if (typeof svc.reload === "function") {
        await svc.reload();
        report.reloaded.items.count = typeof svc.count === "function" ? svc.count() : 0;
      } else if (typeof svc.loadAll === "function") {
        await svc.loadAll();
        report.reloaded.items.count = typeof svc.count === "function" ? svc.count() : 0;
      } else {
        throw new Error("ItemService has no reload()/loadAll()");
      }
    } catch (err: any) {
      report.reloaded.items.ok = false;
      report.reloaded.items.error = String(err?.message ?? err);
      errors.push(`Item reload failed: ${String(err?.message ?? err)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Quests
  // ---------------------------------------------------------------------------
  if (want("quests")) {
    try {
      const loader: any = deps.questLoader;
      if (!loader) {
        warnings.push("No questLoader provided; quests not reloaded.");
      } else if (typeof loader.reload === "function") {
        const defs = await loader.reload();
        if (typeof deps.quests?.setQuestDefinitions === "function") {
          deps.quests.setQuestDefinitions(defs);
        }
        report.reloaded.quests.count = Array.isArray(defs) ? defs.length : 0;
      } else if (typeof loader.loadAll === "function") {
        const defs = await loader.loadAll();
        if (typeof deps.quests?.setQuestDefinitions === "function") {
          deps.quests.setQuestDefinitions(defs);
        }
        report.reloaded.quests.count = Array.isArray(defs) ? defs.length : 0;
      } else {
        throw new Error("questLoader has no reload()/loadAll()");
      }
    } catch (err: any) {
      report.reloaded.quests.ok = false;
      report.reloaded.quests.error = String(err?.message ?? err);
      errors.push(`Quest reload failed: ${String(err?.message ?? err)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // NPCs
  // ---------------------------------------------------------------------------
  if (want("npcs")) {
    try {
      const loader: any = deps.npcLoader;
      if (!loader) {
        warnings.push("No npcLoader provided; NPC prototypes not reloaded.");
      } else if (typeof loader.reload === "function") {
        const protos = await loader.reload();
        if (typeof deps.quests?.setNpcPrototypes === "function") {
          deps.quests.setNpcPrototypes(protos);
        }
        report.reloaded.npcs.count = Array.isArray(protos) ? protos.length : 0;
      } else if (typeof loader.loadAll === "function") {
        const protos = await loader.loadAll();
        if (typeof deps.quests?.setNpcPrototypes === "function") {
          deps.quests.setNpcPrototypes(protos);
        }
        report.reloaded.npcs.count = Array.isArray(protos) ? protos.length : 0;
      } else {
        throw new Error("npcLoader has no reload()/loadAll()");
      }
    } catch (err: any) {
      report.reloaded.npcs.ok = false;
      report.reloaded.npcs.error = String(err?.message ?? err);
      errors.push(`NPC reload failed: ${String(err?.message ?? err)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Spawns
  // ---------------------------------------------------------------------------
  if (want("spawns")) {
    try {
      report.reloaded.spawns.spawnPointCacheCleared =
        await maybeClearSpawnPointCache(warnings);

      report.reloaded.spawns.serviceCacheCleared =
        maybeClearSpawnPointServiceCaches(deps.spawnPoints, warnings);

      // Even if both are false, it can still be OK (no caches to clear).
    } catch (err: any) {
      report.reloaded.spawns.ok = false;
      report.reloaded.spawns.error = String(err?.message ?? err);
      errors.push(`Spawn reload failed: ${String(err?.message ?? err)}`);
    }
  }

  report.durationMs = Date.now() - started;
  report.ok =
    report.reloaded.items.ok &&
    report.reloaded.quests.ok &&
    report.reloaded.npcs.ok &&
    report.reloaded.spawns.ok;

  log.info("Hot reload finished", {
    requested,
    ok: report.ok,
    durationMs: report.durationMs,
    warnings: warnings.length,
    errors: errors.length,
  });

  return report;
}

export function formatHotReloadReport(r: HotReloadReport): string {
  const lines: string[] = [];

  lines.push(
    `[reload] ok=${r.ok} targets=${r.requested.join(",")} (${r.durationMs}ms)`,
  );

  if (r.requested.includes("all") || r.requested.includes("items")) {
    lines.push(
      `[reload] items: ${r.reloaded.items.ok ? "ok" : "fail"}${
        r.reloaded.items.error ? ` (${r.reloaded.items.error})` : ""
      } (count=${r.reloaded.items.count ?? 0})`,
    );
  }

  if (r.requested.includes("all") || r.requested.includes("quests")) {
    lines.push(
      `[reload] quests: ${r.reloaded.quests.ok ? "ok" : "fail"}${
        r.reloaded.quests.error ? ` (${r.reloaded.quests.error})` : ""
      }`,
    );
  }

  if (r.requested.includes("all") || r.requested.includes("npcs")) {
    lines.push(
      `[reload] npcs: ${r.reloaded.npcs.ok ? "ok" : "fail"}${
        r.reloaded.npcs.error ? ` (${r.reloaded.npcs.error})` : ""
      }`,
    );
  }

  if (r.requested.includes("all") || r.requested.includes("spawns")) {
    lines.push(
      `[reload] spawns: ${r.reloaded.spawns.ok ? "ok" : "fail"} (SpawnPointCache=${
        r.reloaded.spawns.spawnPointCacheCleared ? "cleared" : "no-op"
      }, SpawnPointService=${
        r.reloaded.spawns.serviceCacheCleared ? "cleared" : "no-op"
      })`,
    );
  }

  if (r.errors.length) {
    lines.push(`[reload] errors:`);
    for (const e of r.errors) lines.push(`- ${e}`);
  }

  if (r.warnings.length) {
    lines.push(`[reload] warnings:`);
    for (const w of r.warnings) lines.push(`- ${w}`);
  }

  return lines.join(" ");
}
