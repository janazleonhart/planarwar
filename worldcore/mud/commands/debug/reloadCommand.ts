// worldcore/mud/commands/debug/reloadCommand.ts

import { Logger } from "../../../utils/logger";
import { getSelfEntity } from "../../runtime/mudRuntime";
import { announceSpawnToRoom } from "../../MudActions";

import {
  parseHotReloadTargets,
  runHotReload,
  formatHotReloadReport,
  type HotReloadTarget,
  type HotReloadSpawnContext,
} from "../../../dev/HotReloadService";

type MudInput = {
  cmd: string;
  args: string[];
  parts: string[];
  world?: any;
};

const log = Logger.scope("MudReload");

/**
 * Dev-only hot reload command.
 *
 * Usage:
 *   reload
 *   reload all
 *   reload items
 *   reload spawns
 *   reload items spawns
 *   reload spawn_points
 *
 * Notes:
 * - Items: calls ItemService.reload() (or loadAll()) if available.
 * - Spawns: clears spawn caches AND (if available) forces rehydrate + respawn in your current room.
 * - Quests/NPC prototypes: only reload if loaders are provided by the caller (usually not wired in MUD yet).
 */
export async function handleReloadCommand(
  ctx: any,
  char: any,
  input: MudInput,
): Promise<string> {
  const targets: HotReloadTarget[] = parseHotReloadTargets(input.args);

  // Build a spawn refresh context from the player’s current position.
  // This gives HotReloadService enough info to rehydrate POIs + respawn spawn_points-driven NPCs.
  const spawnContexts: HotReloadSpawnContext[] = [];

  try {
    const self = getSelfEntity(ctx);
    const shardId = String(char?.shardId ?? "prime_shard");
    const roomId = String(self?.roomId ?? shardId);

    let regionId = `${shardId}:0,0`;
    const world = ctx.world;
    const x = Number(self?.x ?? 0);
    const z = Number(self?.z ?? 0);

    if (world && typeof world.getRegionAt === "function") {
      const r = world.getRegionAt(x, z);
      if (r?.id) regionId = String(r.id);
    }

    spawnContexts.push({
      shardId,
      regionId,
      roomId,
      ownerSessionId: ctx?.session?.id ? String(ctx.session.id) : undefined,
      // Personal nodes benefit from having the char surface available
      char,
    });
  } catch (err) {
    // Don’t fail the command; hot reload can still do items/quests/npcs.
    log.warn("Failed to build spawn refresh context", { err: String((err as any)?.message ?? err) });
  }

  // Snapshot room entities so we can announce newly materialized POIs after reload.
  const beforeByRoom = new Map<string, Set<string>>();
  if (ctx?.entities && spawnContexts.length > 0) {
    for (const sc of spawnContexts) {
      try {
        const ents = ctx.entities.getEntitiesInRoom?.(sc.roomId) ?? [];
        const set = new Set<string>();
        for (const e of ents) {
          const id = (e as any)?.id;
          if (id) set.add(String(id));
        }
        beforeByRoom.set(sc.roomId, set);
      } catch {
        // ignore
      }
    }
  }

  const report = await runHotReload(targets, {
    items: ctx.items,
    // Not wired in MudContext yet (unless you choose to add it later):
    questLoader: undefined,
    npcLoader: undefined,

    // Spawn refresh (optional, best-effort)
    spawnHydrator: ctx.spawnHydrator,
    npcSpawns: ctx.npcSpawns,
    spawnContexts,
  });

  // If we rehydrated spawns, announce any newly created POI entities to the room.
  // (SpawnHydrator creates entities, but depending on your runtime path, those may not broadcast automatically.)
  if (ctx?.entities && ctx?.rooms && spawnContexts.length > 0 && report.reloaded.spawns) {
    for (const sc of spawnContexts) {
      try {
        const before = beforeByRoom.get(sc.roomId) ?? new Set<string>();
        const after = ctx.entities.getEntitiesInRoom?.(sc.roomId) ?? [];
        for (const e of after) {
          const id = String((e as any)?.id ?? "");
          if (!id || before.has(id)) continue;

          // Broadcast spawn to anyone in the room (safe no-op if room missing)
          try {
            await announceSpawnToRoom(ctx, sc.roomId, e);
          } catch {
            // ignore broadcast failures
          }
        }
      } catch {
        // ignore
      }
    }
  }

  return formatHotReloadReport(report);
}
