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
  templateId: string;    // Base entity template
  roomId: string;        // Target room
  regionId?: string;     // Optional region override
  persistent?: boolean;  // Keep across restarts
  delayMs?: number;      // Optional delayed spawn
};

export type DespawnOptions = {
  entityId: string;
  immediate?: boolean;
};

// ------------------------------------------------------------
// SpawnService
// ------------------------------------------------------------

export class SpawnService {
  private entityManager: EntityManager;
  private roomManager: RoomManager;
  private regionManager?: RegionManager;
  private respawnService?: RespawnService;

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

  // ------------------------------------------------------------
  // Spawning
  // ------------------------------------------------------------

  async spawnEntity(opts: SpawnOptions): Promise<string | undefined> {
    const { templateId, roomId, regionId, persistent, delayMs } = opts;

    if (delayMs && delayMs > 0) {
      setTimeout(() => {
        this.spawnEntity({ ...opts, delayMs: 0 });
      }, delayMs).unref?.();
      return;
    }

    const template = this.loadTemplate(templateId);
    if (!template) {
      log.warn(`Spawn failed: missing template ${templateId}`);
      return;
    }

    const entityId = this.entityManager.createEntity(template);
    if (!entityId) {
      log.error(`Entity creation failed for template ${templateId}`);
      return;
    }

    const room = this.roomManager.getRoom(roomId);
    if (!room) {
      log.warn(`Room ${roomId} not found for entity ${entityId}`);
      this.entityManager.unregister(entityId);
      return;
    }

    this.roomManager.placeEntityInRoom(entityId, roomId);

    if (regionId && this.regionManager) {
      this.regionManager.assignEntityToRegion(entityId, regionId);
    }

    log.success(`Spawned entity ${entityId} in room ${roomId}`);
    if (persistent) {
      this.persistSpawn(templateId, roomId, regionId);
    }

    return entityId;
  }

  // ------------------------------------------------------------
  // Despawning
  // ------------------------------------------------------------

  async despawnEntity(opts: DespawnOptions): Promise<void> {
    const { entityId, immediate } = opts;
    const entity = this.entityManager.get(entityId);
    if (!entity) {
      log.warn(`Despawn failed: entity ${entityId} not found`);
      return;
    }

    if (!immediate && this.respawnService) {
      // Mark for respawn or cleanup
      await this.respawnService.scheduleRespawn(entity);
    }

    this.roomManager.removeEntityFromRoom(entityId);
    this.entityManager.unregister(entityId);

    log.info(`Entity ${entityId} despawned`);
  }

  // ------------------------------------------------------------
  // Internal Helpers
  // ------------------------------------------------------------

  private loadTemplate(templateId: string): any {
    // TODO: Integrate with ItemService / NpcTemplateService
    return { id: templateId, name: `Entity:${templateId}` };
  }

  private persistSpawn(templateId: string, roomId: string, regionId?: string): void {
    // TODO: Implement persistent spawn storage (DB or JSON)
    log.debug(`Persisted spawn: ${templateId} @ ${roomId} [${regionId ?? "no-region"}]`);
  }
}
