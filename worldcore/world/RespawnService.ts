// worldcore/world/RespawnService.ts

import { Logger } from "../utils/logger";
import type { CharacterState } from "../characters/CharacterTypes";
import {
  hasActiveCrimeHeat,
  getCrimeHeatLabel,
} from "../characters/CharacterTypes";
import type { ServerWorldManager } from "./ServerWorldManager";
import {
  SpawnPointService,
  DbSpawnPoint,
} from "./SpawnPointService";
import { EntityManager } from "../core/EntityManager";
import type { Session } from "../shared/Session";

// Keep this tiny: any character store that can save a full state works.
export interface RespawnCharacterStore {
  saveCharacter(state: CharacterState): Promise<void>;
}

const log = Logger.scope("RESPAWN");

/**
 * Handles picking a spawn point and resetting runtime + persisted state.
 *
 * v1:
 * - Picks a reasonably near spawn point for the character.
 * - Teleports entity there, full-heals, clears combat.
 * - Saves CharacterState with the new position + lastRegionId.
 *
 * v2 (this pass):
 * - Prefers "graveyard" / "hub" spawn types where available, so
 *   death returns you to a proper graveyard / safe hub instead of
 *   an arbitrary spawn row.
 *
 * Later, this is where shard death rules + sanctuary / safe-hub
 * logic plug in.
 */
export class RespawnService {
  constructor(
    private readonly world: ServerWorldManager,
    private readonly spawnPoints: SpawnPointService,
    private readonly characters: RespawnCharacterStore,
    private readonly entities: EntityManager
  ) {}

  /**
   * Main entry point: respawn this character that belongs to this session.
   * Returns the updated CharacterState plus the spawn used (if any).
   */
  async respawnCharacter(
    session: Session,
    char: CharacterState
  ): Promise<{ character: CharacterState; spawn: DbSpawnPoint | null }> {
    const shardId = char.shardId;

    // 1) Choose a spawn point for this character.
    const spawn = await this.pickSpawnPointFor(char);

    // Fallback: if there is truly no spawn defined, we just stand them up
    // where they are, but healed.
    const targetX = spawn?.x ?? char.posX;
    const targetY = spawn?.y ?? char.posY;
    const targetZ = spawn?.z ?? char.posZ;
    const targetRegionId =
      spawn?.regionId ?? char.lastRegionId ?? null;

    const nextChar: CharacterState = {
      ...char,
      posX: targetX,
      posY: targetY,
      posZ: targetZ,
      lastRegionId: targetRegionId,
    };

    // 2) Persist character.
    await this.characters.saveCharacter(nextChar);

    // 3) Update session snapshot if this is the attached character.
    if (session.character && session.character.id === nextChar.id) {
      session.character = nextChar;
    }

    // 4) Move the runtime entity + restore HP.
    const ent = this.entities.getEntityByOwner(session.id);
    if (ent) {
      ent.x = targetX;
      ent.y = targetY;
      ent.z = targetZ;

      // v1: simple full-heal + reset flags.
      const e: any = ent;
      e.alive = true;
      if (typeof e.maxHp === "number" && e.maxHp > 0) {
        e.hp = e.maxHp;
      } else {
        e.maxHp = 100;
        e.hp = 100;
      }

      // Clear combat heat on the *entity*; crime heat stays on CharacterState.
      e.inCombatUntil = 0;
    }

    const now = Date.now();
    const crimeHeat = getCrimeHeatLabel(nextChar, now);

    log.info("Character respawned", {
      charId: nextChar.id,
      userId: nextChar.userId,
      shardId,
      x: targetX,
      y: targetY,
      z: targetZ,
      spawnId: spawn?.spawnId,
      spawnDbId: spawn?.id,
      spawnType: spawn?.type,
      regionId: targetRegionId,
      crimeHeat, // "none" | "minor" | "severe"
      hasCrimeHeat: hasActiveCrimeHeat(nextChar, now),
    });

    return { character: nextChar, spawn: spawn ?? null };
  }

  // -------------------------------------------------------------------------
  // Spawn selection
  // -------------------------------------------------------------------------

  /**
   * v2 spawn selection:
   *
   * 1) If we know lastRegionId:
   *    - Get region spawns for that region.
   *    - Prefer type "graveyard" first, then hub-like types.
   *
   * 2) Otherwise, look for nearby spawns in world-space and again
   *    prefer graveyard / hub types when possible.
   *
   * 3) Fallback to the region at world origin (0,0).
   *
   * 4) Absolute last resort: no spawn – stand the character up where
   *    they died.
   */
  private async pickSpawnPointFor(
    char: CharacterState
  ): Promise<DbSpawnPoint | null> {
    const shardId = char.shardId;

    // 1) Try by lastRegionId first (strongest hint about where they belong).
    if (char.lastRegionId) {
      try {
        const regionSpawns =
          await this.spawnPoints.getSpawnPointsForRegion(
            shardId,
            char.lastRegionId
          );

        if (regionSpawns.length > 0) {
          const best = this.chooseBestSpawn(regionSpawns);
          if (best) {
            return best;
          }
          // Fallback within region: just return the first row.
          return regionSpawns[0];
        }
      } catch (err) {
        log.warn("getSpawnPointsForRegion failed", {
          err,
          shardId,
          regionId: char.lastRegionId,
        });
      }
    }

    // 2) Try nearby spawns in world-space around current position.
    try {
      const radius = 500; // meters; v1 “graveyard radius” placeholder.
      const nearby = await this.spawnPoints.getSpawnPointsNear(
        shardId,
        char.posX,
        char.posZ,
        radius
      );

      if (nearby.length > 0) {
        // Prefer graveyard / hub types if any exist in the nearby set.
        const preferred = this.chooseBestSpawn(nearby);
        if (preferred) {
          return preferred;
        }

        // Otherwise: choose the closest one by x/z distance (existing behavior).
        let best = nearby[0];
        let bestDistSq = this.distSq(
          char.posX,
          char.posZ,
          nearby[0].x ?? char.posX,
          nearby[0].z ?? char.posZ
        );

        for (let i = 1; i < nearby.length; i++) {
          const sp = nearby[i];
          const d2 = this.distSq(
            char.posX,
            char.posZ,
            sp.x ?? char.posX,
            sp.z ?? char.posZ
          );
          if (d2 < bestDistSq) {
            best = sp;
            bestDistSq = d2;
          }
        }

        return best;
      }
    } catch (err) {
      log.warn("getSpawnPointsNear failed", {
        err,
        shardId,
        x: char.posX,
        z: char.posZ,
      });
    }

    // 3) Fallback: world origin region if it exists and has spawns.
    try {
      const region = this.world.getRegionAt(0, 0);
      if (region) {
        const originSpawns =
          await this.spawnPoints.getSpawnPointsForRegion(
            shardId,
            region.id
          );
        if (originSpawns.length > 0) {
          const best = this.chooseBestSpawn(originSpawns);
          if (best) {
            return best;
          }
          return originSpawns[0];
        }
      }
    } catch (err) {
      log.warn("Fallback spawn lookup failed", {
        err,
        shardId,
      });
    }

    // 4) Absolute last resort: “no spawn”, we’ll stand them up where they died.
    return null;
  }

  /**
   * Choose the "best" spawn from a set, based purely on type hints.
   *
   * This does NOT consider distance – the caller is expected to
   * provide a relevant subset (region-only, nearby-only, etc.).
   *
   * Priority:
   *   1) type in GRAVEYARD_TYPES
   *   2) type in HUB_TYPES
   *   3) otherwise: no opinion (caller falls back to first/closest)
   */
  private chooseBestSpawn(
    spawns: DbSpawnPoint[]
  ): DbSpawnPoint | null {
    if (!spawns.length) return null;

    const GRAVEYARD_TYPES = new Set<string>([
      "graveyard",
      "graveyard_player",
      "graveyard_safe",
    ]);

    const HUB_TYPES = new Set<string>([
      "hub",
      "town",
      "city",
      "safe_hub",
      "player_start",
    ]);

    // 1) Hard graveyard preference.
    const graveyard = spawns.find((sp) =>
      GRAVEYARD_TYPES.has(sp.type)
    );
    if (graveyard) return graveyard;

    // 2) Otherwise, hub-like safe areas.
    const hub = spawns.find((sp) => HUB_TYPES.has(sp.type));
    if (hub) return hub;

    // 3) No strong preference within this set.
    return null;
  }

  private distSq(
    ax: number,
    az: number,
    bx: number,
    bz: number
  ): number {
    const dx = ax - bx;
    const dz = az - bz;
    return dx * dx + dz * dz;
  }
}
