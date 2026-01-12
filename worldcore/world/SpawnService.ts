// worldcore/world/SpawnService.ts
// ------------------------------------------------------------
// Purpose:
// Handles controlled spawning and despawning of entities within
// the world. Integrates with EntityManager, RoomManager, and
// optional RegionManager and RespawnService systems to ensure
// safe placement, cleanup, and event emission.
// ------------------------------------------------------------

import { EntityManager } from "../core/EntityManager";
import { RoomManager } from "../core/RoomManager";
import { Logger } from "../utils/logger";
import type { RegionManager } from "./RegionManager";
import type { RespawnService } from "./RespawnService";

const log = Logger.scope("SPAWN");

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export type SpawnOptions = {
  templateId: string;  // Base entity template id (for now, just a label)
  roomId: string;      // Target room
  regionId?: string;   // Optional region override
  persistent?: boolean; // Keep across restarts (stubbed)
  delayMs?: number;    // Optional delayed spawn
};

export type DespawnOptions = {
  entityId: string;
  immediate?: boolean;
};

// ------------------------------------------------------------
// SpawnService
// ------------------------------------------------------------

export class SpawnService {
  private readonly entityManager: EntityManager;
  private readonly roomManager: RoomManager;
  private readonly regionManager?: RegionManager;
  private readonly respawnService?: RespawnService;

  constructor(opts: {
    entityManager: EntityManager;
    roomManager: RoomManager;
    regionManager?: RegionManager;
    respawnService?: RespawnService;
  }) {
    this.entityManager = opts.entityManager;
    this.roomManager = opts.roomManager;
    this.regionManager = opts.regionManager;
    this.respawnService = opts.respawnService;
  }

  // ----------------------------------------------------------
  // Spawning
  // ----------------------------------------------------------

  /**
   * Spawn an entity into a room.
   *
   * v1 implementation:
   * - Uses EntityManager.createNpcEntity(roomId, templateId) as a generic
   *   way to get a runtime entity.
   * - Optional delay uses setTimeout and re-calls spawnEntity.
   */
  async spawnEntity(opts: SpawnOptions): Promise<string | undefined> {
    const { templateId, roomId, regionId, persistent, delayMs } = opts;

    if (delayMs && delayMs > 0) {
      const handle = setTimeout(() => {
        // Fire-and-forget follow-up with delay cleared
        void this.spawnEntity({ ...opts, delayMs: 0 });
      }, delayMs).unref?.();

      return;
    }

    // For now, the "template" is just a model/name label.
    const entity = this.entityManager.createNpcEntity(roomId, templateId);
    const entityId = entity.id;

    const room = this.roomManager.get(roomId);
    if (!room) {
      log.warn("Spawn failed: room not found", { roomId, entityId });
      this.entityManager.removeEntity(entityId);
      return;
    }

    // Room membership is session-based; entities are attached to a roomId
    // directly on the entity. We've already set entity.roomId above.

    if (regionId && this.regionManager) {
      try {
        this.regionManager.assignEntityToRegion(entityId, regionId);
      } catch (err) {
        log.warn("Failed to assign entity to region", {
          entityId,
          regionId,
          err,
        });
      }
    }

    log.info("Spawned entity", { entityId, roomId, templateId });

    if (persistent) {
      this.persistSpawn(templateId, roomId, regionId);
    }

    return entityId;
  }

  // ----------------------------------------------------------
  // Despawning
  // ----------------------------------------------------------

  /**
   * Despawn an entity from the world.
   *
   * v1:
   * - Simply removes the entity from EntityManager.
   * - Does not yet integrate with RespawnService; that logic currently
   *   lives in NPC / combat flows (RespawnService.respawnCharacter).
   */
  async despawnEntity(opts: DespawnOptions): Promise<void> {
    const { entityId, immediate } = opts;

    const entity = this.entityManager.get(entityId);
    if (!entity) {
      log.warn("Despawn failed: entity not found", { entityId });
      return;
    }

    // Future hook for respawn scheduling per-entity.
    if (!immediate && this.respawnService) {
      // No generic schedule API yet; RespawnService is focused on characters.
      log.debug("RespawnService present but not used for generic despawn", {
        entityId,
      });
    }

    this.entityManager.removeEntity(entityId);
    log.info("Entity despawned", { entityId });
  }

  // ------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------

  private persistSpawn(
    templateId: string,
    roomId: string,
    regionId?: string
  ): void {
    // TODO: Implement persistent spawn storage (DB or JSON).
    log.debug("Persisted spawn (stub)", {
      templateId,
      roomId,
      regionId: regionId ?? null,
    });
  }
}
