// worldcore/mud/commands/world/moveCommand.ts

import { moveCharacterAndSync } from "../../../movement/moveOps";
import { DIR_LABELS, parseMoveDir, tryMoveCharacter } from "../../../movement/MovementCommands";
import type { CharacterState } from "../../../characters/CharacterTypes";
import type { ServerWorldManager } from "../../../world/ServerWorldManager";
import { isGMOrHigher } from "../../../shared/AuthTypes";
import {
  isTownSanctuaryForRegionSync,
  isTravelLockdownOnSiegeForRegionSync,
} from "../../../world/RegionFlags";

function parseStepsToken(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  // allow: "64", "64," etc.
  const cleaned = raw.trim().replace(/,+$/, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return undefined;
  const i = Math.trunc(n);
  if (i <= 0) return undefined;
  return i;
}

function clampSteps(raw: number | undefined, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : 1;
  if (!Number.isFinite(n)) return 1;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function envFlag(name: string, defaultValue = false): boolean {
  const v = String(process.env[name] ?? "").trim().toLowerCase();
  if (!v) return defaultValue;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function envInt(name: string, defaultValue: number): number {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return defaultValue;
  const n = Number(raw);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.trunc(n);
}

function getShardId(world: ServerWorldManager): string {
  const bp: any = (world as any).getWorldBlueprint?.() ?? {};
  return bp.shardId ?? bp.id ?? "prime_shard";
}

export async function handleMoveCommand(
  ctx: any,
  char: CharacterState,
  input: {
    cmd: string;
    args: string[];
    parts: string[];
    world?: ServerWorldManager;
  },
): Promise<string> {
  const world = input.world;
  if (!world) return "The world is unavailable.";

  const dir = parseMoveDir(input.args[0]);
  if (!dir) {
    return "Usage: move <dir> [steps]";
  }

  const requestedSteps = parseStepsToken(input.args[1]) ?? 1;
  const steps = clampSteps(requestedSteps, 1, 256);

  // Staff-only: multi-step movement is a dev/GM tool.
  // (Normal players will later get speed via mounts, buffs, teleport, etc.)
  if (steps > 1) {
    const flags = ctx?.session?.identity?.flags;
    if (!isGMOrHigher(flags)) {
      return "You can only move 1 step at a time.";
    }
  }

  // Optional travel lockdown: if the destination region is a town sanctuary that is
  // currently under siege, regions may choose to deny entry.
  //
  // Convention:
  // - regions.flags.rules.travel.lockdownOnSiege = true
  //
  // This is evaluated BEFORE applying movement so we never “step in” and then undo.
  if (steps === 1) {
    try {
      const sim = { ...(char as any) } as CharacterState;
      const simRes = tryMoveCharacter(sim, dir, world, 1);
      if (simRes.ok) {
        const destRegionId = (sim as any).lastRegionId as string | null;
        if (destRegionId) {
          const shardId = (char as any).shardId ?? getShardId(world);
          const destRoomId = `${shardId}:${destRegionId}`;

          const townSiege = ctx?.townSiege;
          const underSiege = !!townSiege?.isUnderSiege?.(destRoomId, Date.now());

          if (underSiege && isTownSanctuaryForRegionSync(shardId, destRegionId)) {
            const lockdown = isTravelLockdownOnSiegeForRegionSync(shardId, destRegionId);
            if (lockdown) {
              return "The gates are sealed — the town is under siege.";
            }
          }
        }
      }
    } catch {
      // Fail-open: movement must not crash because travel rules couldn't be evaluated.
    }
  }

  const prevRegionId = (char as any).lastRegionId;

  const res = await moveCharacterAndSync(ctx, char, dir, world, steps);
  if (!res.ok) return res.reason;

  // --- Region-crossing hooks (dev-safe) ---
  try {
    const newRegionId = (char as any).lastRegionId ?? prevRegionId;
    const regionChanged = !!newRegionId && newRegionId !== prevRegionId;

    if (regionChanged) {
      const roomId = ctx?.session?.roomId;
      const shardId = getShardId(world);

      // 1) POI hydration (DB -> inert POI entities)
      if (envFlag("WORLD_SPAWNS_ENABLED", false)) {
        const hydrator = ctx?.spawnHydrator;
        if (hydrator?.rehydrateRoom && roomId) {
          await hydrator.rehydrateRoom({
            shardId,
            regionId: newRegionId,
            roomId,
          });
        }
      }

      // 2) Optional: spawn shared NPCs near you (kept OFF by default)
      if (envFlag("WORLD_NPC_SPAWNS_ENABLED", false)) {
        const npcSpawns = ctx?.npcSpawns;
        if (npcSpawns?.spawnNear && roomId) {
          const radius = envInt("WORLD_NPC_SPAWN_RADIUS", 80);
          await npcSpawns.spawnNear(
            shardId,
            (char as any).posX ?? 0,
            (char as any).posZ ?? 0,
            radius,
            roomId,
          );
        }
      }
    }
  } catch {
    // Movement should never fail because spawn hydration/spawning failed.
  }

  const label = DIR_LABELS[dir] ?? (input.args[0] ?? dir).toLowerCase();
  if (steps === 1) return `You move ${label}.`;
  return `You move ${label} (${steps} steps).`;
}
