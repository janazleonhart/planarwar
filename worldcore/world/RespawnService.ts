// worldcore/world/RespawnService.ts

import { Logger } from "../utils/logger";
import type { CharacterState } from "../characters/CharacterTypes";
import { hasActiveCrimeHeat, getCrimeHeatLabel } from "../characters/CharacterTypes";
import type { ServerWorldManager } from "./ServerWorldManager";
import type { DbSpawnPoint } from "./SpawnPointService";
import { SpawnPointService } from "./SpawnPointService";
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
 * v3 (this pass):
 * - Graveyards are no longer always preferred.
 * - If a town/hub/city is closer than the nearest graveyard (and eligible),
 *   we respawn at the closer settlement instead.
 *
 * Eligibility hook:
 * - In the future: town/hub respawn is only allowed if the player isn't KOS there.
 * - For now: all settlements are allowed unless spawn.variantId is "kos" or "hostile"
 *   (tiny placeholder so we can test behavior immediately).
 */
export class RespawnService {
  constructor(
    private readonly world: ServerWorldManager,
    private readonly spawnPoints: SpawnPointService,
    private readonly characters: RespawnCharacterStore,
    private readonly entities: EntityManager,
  ) {}

  /**
   * Main entry point: respawn this character that belongs to this session.
   * Returns the updated CharacterState plus the spawn used (if any).
   */
  async respawnCharacter(
    session: Session,
    char: CharacterState,
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
   * Spawn selection:
   *
   * 1) If we know lastRegionId:
   *    - Get region spawns for that region.
   *    - Pick best respawn spawn using distance+policy:
   *      settlement if closer than graveyard (and eligible), else graveyard.
   *
   * 2) Otherwise, look for nearby spawns in world-space and pick best respawn spawn.
   *
   * 3) Fallback to the region at world origin (0,0).
   *
   * 4) Absolute last resort: no spawn – stand the character up where they died.
   */
  private async pickSpawnPointFor(char: CharacterState): Promise<DbSpawnPoint | null> {
    const shardId = char.shardId;

    // 1) Try by lastRegionId first (strongest hint about where they belong).
    if (char.lastRegionId) {
      try {
        const regionSpawns = await this.spawnPoints.getSpawnPointsForRegion(
          shardId,
          char.lastRegionId,
        );

        if (regionSpawns.length > 0) {
          const best = this.chooseBestRespawnSpawn(char, regionSpawns);
          return best ?? regionSpawns[0];
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
      const radius = 500; // placeholder "coverage radius"
      const nearby = await this.spawnPoints.getSpawnPointsNear(
        shardId,
        char.posX,
        char.posZ,
        radius,
      );

      if (nearby.length > 0) {
        const best = this.chooseBestRespawnSpawn(char, nearby);
        return best ?? this.chooseClosestByDistance(char, nearby) ?? nearby[0];
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
          region.id,
        );

        if (originSpawns.length > 0) {
          const best = this.chooseBestRespawnSpawn(char, originSpawns);
          return best ?? originSpawns[0];
        }
      }
    } catch (err) {
      log.warn("Fallback spawn lookup failed", { err, shardId });
    }

    // 4) Absolute last resort: “no spawn”, we’ll stand the character up where they died.
    return null;
  }

  /**
   * Best respawn rule:
   * - Let settlement spawns (town/hub/city/etc) "win" if they are closer than the nearest graveyard,
   *   AND the settlement is eligible for this character.
   * - Otherwise choose nearest graveyard.
   * - Otherwise choose nearest spawn of any type.
   *
   * NOTE: This relies on distance, so it gracefully handles cross-region spawns too.
   */
  private chooseBestRespawnSpawn(char: CharacterState, spawns: DbSpawnPoint[]): DbSpawnPoint | null {
    if (!spawns.length) return null;

    let nearestAny: DbSpawnPoint | null = null;
    let nearestAnyD2 = Number.POSITIVE_INFINITY;

    let nearestGy: DbSpawnPoint | null = null;
    let nearestGyD2 = Number.POSITIVE_INFINITY;

    let nearestSettlement: DbSpawnPoint | null = null;
    let nearestSettlementD2 = Number.POSITIVE_INFINITY;

    for (const sp of spawns) {
      const sx = sp.x;
      const sz = sp.z;
      if (typeof sx !== "number" || typeof sz !== "number") continue;

      const d2 = this.distSq(char.posX, char.posZ, sx, sz);

      if (d2 < nearestAnyD2) {
        nearestAny = sp;
        nearestAnyD2 = d2;
      }

      if (this.isGraveyardType(sp.type)) {
        if (d2 < nearestGyD2) {
          nearestGy = sp;
          nearestGyD2 = d2;
        }
        continue;
      }

      if (this.isSettlementType(sp.type) && this.isSettlementEligibleFor(char, sp)) {
        if (d2 < nearestSettlementD2) {
          nearestSettlement = sp;
          nearestSettlementD2 = d2;
        }
      }
    }

    // If settlement is closer than graveyard (or there is no graveyard), pick settlement.
    if (nearestSettlement && (!nearestGy || nearestSettlementD2 < nearestGyD2)) {
      return nearestSettlement;
    }

    // Otherwise pick graveyard if any.
    if (nearestGy) return nearestGy;

    // Otherwise pick closest of any type.
    if (nearestAny) return nearestAny;

    // No coordinate-bearing spawns; fall back to "type-only" preference.
    return this.chooseBestSpawnByTypeOnly(spawns);
  }

  private chooseClosestByDistance(char: CharacterState, spawns: DbSpawnPoint[]): DbSpawnPoint | null {
    let best: DbSpawnPoint | null = null;
    let bestD2 = Number.POSITIVE_INFINITY;

    for (const sp of spawns) {
      if (typeof sp.x !== "number" || typeof sp.z !== "number") continue;
      const d2 = this.distSq(char.posX, char.posZ, sp.x, sp.z);
      if (d2 < bestD2) {
        best = sp;
        bestD2 = d2;
      }
    }

    return best;
  }

  /**
   * Placeholder settlement eligibility.
   *
   * Future: check faction standings / KOS / sanctuary rules.
   * For now:
   * - allow by default
   * - BUT if the spawn carries variantId "kos" or "hostile", treat it as not eligible.
   *   (This gives you an immediate on/off lever for testing before faction is built.)
   */
  private isSettlementEligibleFor(_char: CharacterState, spawn: DbSpawnPoint): boolean {
    const v = spawn.variantId;
    if (v === "kos" || v === "hostile") return false;
    return true;
  }

  private isGraveyardType(type: string): boolean {
    return type === "graveyard" || type === "graveyard_player" || type === "graveyard_safe";
  }

  private isSettlementType(type: string): boolean {
    // Settlement-ish spawn types
    return (
      type === "hub" ||
      type === "town" ||
      type === "city" ||
      type === "safe_hub" ||
      type === "player_start"
    );
  }

  /**
   * Type-only preference used only when no spawns have x/z (rare).
   * Kept to avoid breaking behavior in edge data states.
   */
  private chooseBestSpawnByTypeOnly(spawns: DbSpawnPoint[]): DbSpawnPoint | null {
    const graveyard = spawns.find((sp) => this.isGraveyardType(sp.type));
    if (graveyard) return graveyard;

    const settlement = spawns.find((sp) => this.isSettlementType(sp.type));
    if (settlement) return settlement;

    return null;
  }

  private distSq(ax: number, az: number, bx: number, bz: number): number {
    const dx = ax - bx;
    const dz = az - bz;
    return dx * dx + dz * dz;
  }
}
