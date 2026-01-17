// worldcore/dev/HotReloadService.ts

import { Logger } from "../utils/logger";
import type { ItemService } from "../items/ItemService";
import type { QuestDefinition } from "../quests/QuestTypes";
import type { NpcPrototype } from "../npc/NpcTypes";
import { setQuestDefinitions } from "../quests/QuestRegistry";
import { setNpcPrototypes } from "../npc/NpcTypes";

const log = Logger.scope("HOT_RELOAD");

export type HotReloadTarget = "all" | "items" | "quests" | "npcs" | "spawns";

export interface HotReloadDeps {
  items?: ItemService;

  questLoader?: {
    listQuests(): Promise<QuestDefinition[]>;
  };

  npcLoader?: {
    listNpcs(): Promise<NpcPrototype[]>;
  };

  /**
   * Optional: whatever object owns spawn point caching in your runtime.
   * We duck-type against common names: clearCache / invalidateAll / reset.
   */
  spawnPoints?: any;
}

export interface HotReloadReport {
  ok: boolean;
  requested: HotReloadTarget[];
  durationMs: number;

  reloaded: {
    items?: { ok: boolean; count?: number };
    quests?: { ok: boolean; count?: number };
    npcs?: { ok: boolean; count?: number };
    spawns?: { ok: boolean; spawnPointCacheCleared: boolean; serviceCacheCleared: boolean };
  };

  warnings: string[];
  errors: string[];
}

function isNodeTestRuntime(): boolean {
  return (
    process.execArgv.includes("--test") ||
    process.argv.includes("--test") ||
    process.env.NODE_ENV === "test" ||
    process.env.WORLDCORE_TEST === "1"
  );
}

function uniqTargets(targets: HotReloadTarget[]): HotReloadTarget[] {
  const set = new Set<HotReloadTarget>();
  for (const t of targets) set.add(t);
  // If "all" is present, we collapse to ["all"] for clarity.
  if (set.has("all")) return ["all"];
  return Array.from(set.values());
}

export function parseHotReloadTargets(args: string[]): HotReloadTarget[] {
  const raw = (args[0] ?? "all").trim().toLowerCase();
  if (!raw) return ["all"];

  const tokens = raw
    .split(/[,\s]+/g)
    .map((t) => t.trim())
    .filter(Boolean);

  const out: HotReloadTarget[] = [];
  for (const t of tokens) {
    switch (t) {
      case "all":
      case "*":
        out.push("all");
        break;
      case "item":
      case "items":
        out.push("items");
        break;
      case "quest":
      case "quests":
        out.push("quests");
        break;
      case "npc":
      case "npcs":
        out.push("npcs");
        break;
      case "spawn":
      case "spawns":
      case "spawnpoints":
      case "spawn_points":
        out.push("spawns");
        break;
      default:
        // Ignore unknown tokens; caller can show usage.
        break;
    }
  }

  return uniqTargets(out.length > 0 ? out : ["all"]);
}

async function maybeClearSpawnPointCache(warnings: string[]): Promise<boolean> {
  // Tests should not touch runtime caches or open weird imports.
  if (isNodeTestRuntime()) return false;

  try {
    const mod: any = await import("../world/SpawnPointCache");

    const candidates = [
      mod.clearSpawnPointCache,
      mod.resetSpawnPointCache,
      mod.invalidateSpawnPointCache,
      mod.clearCache,
    ];

    for (const fn of candidates) {
      if (typeof fn === "function") {
        fn();
        return true;
      }
    }

    warnings.push(
      "SpawnPointCache module loaded but no clear/reset function found (expected one of: clearSpawnPointCache/resetSpawnPointCache/...).",
    );
    return false;
  } catch (err) {
    warnings.push("SpawnPointCache module not cleared (import failed).");
    return false;
  }
}

function maybeClearSpawnPointServiceCache(spawnPoints: any, warnings: string[]): boolean {
  if (!spawnPoints) return false;

  const fns = [
    spawnPoints.clearCache,
    spawnPoints.invalidateAll,
    spawnPoints.invalidateCache,
    spawnPoints.resetCache,
  ];

  for (const fn of fns) {
    if (typeof fn === "function") {
      try {
        fn.call(spawnPoints);
        return true;
      } catch (err) {
        warnings.push("SpawnPointService cache clear failed (method threw).");
        return false;
      }
    }
  }

  warnings.push("SpawnPointService present but no cache clear method detected.");
  return false;
}

export async function runHotReload(
  targets: HotReloadTarget[],
  deps: HotReloadDeps,
): Promise<HotReloadReport> {
  const requested = uniqTargets(targets.length > 0 ? targets : ["all"]);
  const want = (t: Exclude<HotReloadTarget, "all">) =>
    requested.includes("all") || requested.includes(t);

  const warnings: string[] = [];
  const errors: string[] = [];

  const started = Date.now();

  const report: HotReloadReport = {
    ok: true,
    requested,
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
      warnings.push("No ItemService available in context; items not reloaded.");
      report.reloaded.items = { ok: false };
    } else {
      try {
        const svc: any = deps.items as any;
        if (typeof svc.reload === "function") {
          await svc.reload();
        } else if (typeof svc.loadAll === "function") {
          await svc.loadAll();
        } else {
          throw new Error("ItemService has no reload()/loadAll()");
        }

        const count =
          typeof (deps.items as any).listAll === "function"
            ? (deps.items as any).listAll().length
            : undefined;

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
  // Spawn caches (best-effort)
  // ---------------------------------------------------------------------------
  if (want("spawns")) {
    const spawnPointCacheCleared = await maybeClearSpawnPointCache(warnings);
    const serviceCacheCleared = maybeClearSpawnPointServiceCache(deps.spawnPoints, warnings);

    report.reloaded.spawns = {
      ok: true,
      spawnPointCacheCleared,
      serviceCacheCleared,
    };
  }

  report.durationMs = Date.now() - started;

  // Helpful logging for server operators.
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
    lines.push(
      `[reload] spawns: ok (SpawnPointCache=${r.reloaded.spawns.spawnPointCacheCleared ? "cleared" : "no-op"}, SpawnPointService=${r.reloaded.spawns.serviceCacheCleared ? "cleared" : "no-op"})`,
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
