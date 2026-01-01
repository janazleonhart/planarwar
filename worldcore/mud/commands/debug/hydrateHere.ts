// worldcore/mud/commands/debug/hydrateHere.ts

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";

type MudInput = {
  cmd: string;
  args: any;   // can be string[] or something else depending on caller
  parts: any;  // can be string[] or string
  raw?: string;
  world?: any;
};

function toArgArray(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") return v.trim().length ? v.trim().split(/\s+/) : [];
  return [];
}

function hasFlag(argv: string[], long: string, short?: string): boolean {
  const set = new Set(argv.map((s) => s.toLowerCase()));
  return set.has(long.toLowerCase()) || (short ? set.has(short.toLowerCase()) : false);
}

function getShardId(ctx: MudContext): string {
  const world: any = (ctx as any).world;
  const bp: any = world?.getWorldBlueprint?.() ?? {};
  return bp.shardId ?? bp.id ?? "prime_shard";
}

function getRegionId(ctx: MudContext, char: CharacterState): string {
  // Prefer authoritative character state
  const r = (char as any).lastRegionId;
  if (typeof r === "string" && r.length > 0) return r;

  // Fallback: ask the world
  const world: any = (ctx as any).world;
  const x = (char as any).posX ?? 0;
  const z = (char as any).posZ ?? 0;
  const region = world?.getRegionAt?.(x, z);
  const id = region?.id ?? region?.regionId;
  if (typeof id === "string" && id.length > 0) return id;

  return "prime_shard:0,0";
}

/**
 * Force-hydrate spawn_points for your current region into your current room.
 *
 * Usage:
 *   debug_hydrate_here
 *   debug_hydrate_here --dry
 *
 * Notes:
 * - This ignores the hydrator cache via force=true (by design).
 * - This does NOT require WORLD_SPAWNS_ENABLED because it's a debug command.
 */
export async function handleDebugHydrateHere(
  ctx: MudContext,
  char: CharacterState,
  input: MudInput
): Promise<string> {
  const hydrator: any = (ctx as any).spawnHydrator;
  if (!hydrator?.rehydrateRoom) {
    return "[debug] SpawnHydrator is not available on MudContext.";
  }

  const roomId = (ctx.session as any)?.roomId;
  if (!roomId) return "[debug] Missing session.roomId; cannot hydrate.";

  const argv = toArgArray(input?.args?.length ? input.args : input?.parts);
  const dryRun = hasFlag(argv, "--dry", "-n");

  const shardId = getShardId(ctx);
  const regionId = getRegionId(ctx, char);

  const result = await hydrator.rehydrateRoom({
    shardId,
    regionId,
    roomId,
    dryRun,
    force: true, // ✅ always force (this command exists specifically to re-run hydration)
  });

  return (
    `[debug] Hydrated region=${regionId} room=${roomId} ` +
    `(total=${result.total}, eligible=${result.eligible}, spawned=${result.spawned}` +
    (dryRun ? `, wouldSpawn=${result.wouldSpawn}` : "") +
    `, skippedExisting=${result.skippedExisting})`
  );
}
