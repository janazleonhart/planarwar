// worldcore/world/RespawnService.ts

import { Logger } from "../utils/logger";
import type { CharacterState } from "../characters/CharacterTypes";
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
 * v1+:
 * - Prefers a closer eligible settlement (town/hub/etc) over a farther graveyard.
 * - Falls back to graveyard if the closer settlement is ineligible (e.g. KOS).
 * - Teleports entity there, full-heals, clears combat.
 * - Saves CharacterState with the new position + lastRegionId.
 *
 * Later, this is where shard death rules + sanctuary logic will plug in.
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
    const spawn = await this.pickSpawnPointFor(session, char);

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
      e.inCombatUntil = 0;
    }

    log.info("Character respawned", {
      charId: nextChar.id,
      userId: nextChar.userId,
      shardId,
      x: targetX,
      y: targetY,
      z: targetZ,
      spawnId: spawn?.spawnId,
      regionId: targetRegionId,
    });

    return { character: nextChar, spawn: spawn ?? null };
  }

  // ---------------------------------------------------------------------------
  // Spawn selection
  // ---------------------------------------------------------------------------

  private async pickSpawnPointFor(
    session: Session,
    char: CharacterState,
  ): Promise<DbSpawnPoint | null> {
    const shardId = char.shardId;

    // 1) Try by lastRegionId first (strongest hint about where they belong).
    if (char.lastRegionId) {
      try {
        const regionSpawns = await this.spawnPoints.getSpawnPointsForRegion(
          shardId,
          char.lastRegionId,
        );
        const chosen = this.chooseBestSpawn(session, char, regionSpawns);
        if (chosen) return chosen;
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
        radius,
      );
      const chosen = this.chooseBestSpawn(session, char, nearby);
      if (chosen) return chosen;
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
        const chosen = this.chooseBestSpawn(session, char, originSpawns);
        if (chosen) return chosen;
      }
    } catch (err) {
      log.warn("Fallback spawn lookup failed", { err, shardId });
    }

    // 4) Absolute last resort: “no spawn”, we’ll stand them up where they died.
    return null;
  }

  /**
   * Core rule:
   * - Prefer the closest *eligible* settlement (town/hub/etc) IF it is closer than the closest graveyard.
   * - If the closest settlement is ineligible (e.g. KOS), fall back to graveyard.
   * - Otherwise fall back to closest spawn of any type.
   */
  private chooseBestSpawn(
    session: Session,
    char: CharacterState,
    spawns: DbSpawnPoint[],
  ): DbSpawnPoint | null {
    if (!spawns || spawns.length === 0) return null;

    const settlements: DbSpawnPoint[] = [];
    const graveyards: DbSpawnPoint[] = [];
    const other: DbSpawnPoint[] = [];

    for (const sp of spawns) {
      if (this.isGraveyardType(sp.type)) graveyards.push(sp);
      else if (this.isSettlementType(sp.type)) settlements.push(sp);
      else other.push(sp);
    }

    const bestGraveyard = this.closestByXZ(char.posX, char.posZ, graveyards);
    const bestEligibleSettlement = this.closestByXZ(
      char.posX,
      char.posZ,
      settlements.filter((s) => this.isSettlementEligible(session, char, s)),
    );

    if (bestEligibleSettlement) {
      const sD2 = this.spawnDistSq(char.posX, char.posZ, bestEligibleSettlement);
      const gD2 = bestGraveyard
        ? this.spawnDistSq(char.posX, char.posZ, bestGraveyard)
        : Number.POSITIVE_INFINITY;

      if (!bestGraveyard || sD2 < gD2) return bestEligibleSettlement;
    }

    if (bestGraveyard) return bestGraveyard;

    // Fallback: closest of anything remaining
    const bestAny = this.closestByXZ(char.posX, char.posZ, [
      ...settlements,
      ...other,
    ]);
    return bestAny ?? null;
  }

  private isSettlementType(type: string): boolean {
    const t = (type || "").toLowerCase();
    return (
      t === "town" ||
      t === "hub" ||
      t === "village" ||
      t === "city" ||
      t === "settlement" ||
      t === "outpost"
    );
  }

  private isGraveyardType(type: string): boolean {
    const t = (type || "").toLowerCase();
    return t === "graveyard" || t === "checkpoint";
  }

  /**
   * v0 eligibility:
   * - variantId === "kos" => ineligible (hostile / kill-on-sight placeholder)
   *
   * Later:
   * - check faction standing / reputation
   * - check settlement ownership / access rules
   */
  private isSettlementEligible(
    _session: Session,
    _char: CharacterState,
    spawn: DbSpawnPoint,
  ): boolean {
    return (spawn.variantId ?? null) !== "kos";
  }

  private closestByXZ(
    ax: number,
    az: number,
    spawns: DbSpawnPoint[],
  ): DbSpawnPoint | null {
    if (!spawns || spawns.length === 0) return null;

    let best: DbSpawnPoint | null = null;
    let bestDistSq = Number.POSITIVE_INFINITY;

    for (const sp of spawns) {
      const d2 = this.spawnDistSq(ax, az, sp);
      if (d2 < bestDistSq) {
        best = sp;
        bestDistSq = d2;
      }
    }
    return best;
  }

  private spawnDistSq(ax: number, az: number, sp: DbSpawnPoint): number {
    if (sp.x == null || sp.z == null) return Number.POSITIVE_INFINITY;
    const dx = ax - sp.x;
    const dz = az - sp.z;
    return dx * dx + dz * dz;
  }
}
