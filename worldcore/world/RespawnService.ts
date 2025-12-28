// worldcore/world/RespawnService.ts

import { Logger } from "../utils/logger";
import type { CharacterState } from "../characters/CharacterTypes";
import {
  hasActiveCrimeHeat,
  getCrimeHeatLabel,
} from "../characters/CharacterTypes";
import type { ServerWorldManager } from "./ServerWorldManager";
import { SpawnPointService, DbSpawnPoint } from "./SpawnPointService";
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
 * Later, this is where shard death rules + sanctuary / safe-hub logic plug in.
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
    const targetRegionId = spawn?.regionId ?? char.lastRegionId ?? null;

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
      regionId: targetRegionId,
      crimeHeat, // "none" | "minor" | "severe"
      hasCrimeHeat: hasActiveCrimeHeat(nextChar, now),
    });

    return { character: nextChar, spawn: spawn ?? null };
  }

  // ---------------------------------------------------------------------------
  // Spawn selection
  // ---------------------------------------------------------------------------

  private async pickSpawnPointFor(
    char: CharacterState
  ): Promise<DbSpawnPoint | null> {
    const shardId = char.shardId;

    // 1) Try by lastRegionId first (strongest hint about where they belong).
    if (char.lastRegionId) {
      try {
        const regionSpawns = await this.spawnPoints.getSpawnPointsForRegion(
          shardId,
          char.lastRegionId
        );

        if (regionSpawns.length > 0) {
          // v1: just take the first; later we can weight by type/priority
          // (including hub/sanctuary tags) if we want.
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
        // Choose the closest one by x/z distance.
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
        const originSpawns = await this.spawnPoints.getSpawnPointsForRegion(
          shardId,
          region.id
        );

        if (originSpawns.length > 0) {
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
