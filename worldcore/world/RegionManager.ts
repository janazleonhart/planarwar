// worldcore/world/RegionManager.ts
// ------------------------------------------------------------
// Purpose:
// Governs world regions, zones, and shard-aware spatial ownership.
// Serves as the authoritative registry connecting RoomManager,
// EntityManager, and higher-level MMO services (persistence,
// respawn, and shard routing).
//
// This module ensures region-based control of entities, room
// clusters, and cross-zone transitions.
// ------------------------------------------------------------

import { RoomManager } from "../core/RoomManager";
import { EntityManager } from "../core/EntityManager";
import { RespawnService } from "./RespawnService";
import { Logger } from "../utils/logger";

const log = Logger.scope("REGION");

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export type RegionDefinition = {
  id: string;
  name: string;
  zoneIds: string[];
  shard?: string; // Optional for multi-shard deployments
  lawLevel?: number; // Law intensity / enforcement index
  respawnPoint?: string; // Default respawn roomId
  weather?: string; // Optional visual/environmental flavor
};

/**
 * Minimal shard-facing contract for RegionManager.
 * We keep this local so worldcore does NOT import from mmo-backend.
 */
export interface RegionShardService {
  getDefaultShard(): string;
}

// ------------------------------------------------------------
// RegionManager
// ------------------------------------------------------------

export class RegionManager {
  private readonly regions: Map<string, RegionDefinition> = new Map();
  private readonly entityManager: EntityManager;
  private readonly roomManager: RoomManager;
  private readonly respawnService?: RespawnService;
  private shardService?: RegionShardService;

  constructor(opts: {
    entityManager: EntityManager;
    roomManager: RoomManager;
    respawnService?: RespawnService;
    shardService?: RegionShardService;
  }) {
    this.entityManager = opts.entityManager;
    this.roomManager = opts.roomManager;
    this.respawnService = opts.respawnService;
    this.shardService = opts.shardService;
  }

  // ------------------------------------------------------------
  // Initialization
  // ------------------------------------------------------------

  async initialize(regions: RegionDefinition[]): Promise<void> {
    for (const def of regions) {
      this.regions.set(def.id, def);
      log.info(`Loaded region: ${def.name} [${def.id}]`);
    }

    log.success(`Initialized RegionManager with ${regions.length} region(s).`);
  }

  getRegion(id: string): RegionDefinition | undefined {
    return this.regions.get(id);
  }

  getAllRegions(): RegionDefinition[] {
    return Array.from(this.regions.values());
  }

  // ------------------------------------------------------------
  // Entity & Room Integration
  // ------------------------------------------------------------

  /**
   * Attach a region id to an entity's runtime state.
   * This does NOT move the entity between rooms; it just tags it.
   */
  assignEntityToRegion(entityId: string, regionId: string): boolean {
    const region = this.regions.get(regionId);
    if (!region) {
      log.warn(`Cannot assign entity ${entityId}: region ${regionId} not found`);
      return false;
    }

    const entity = this.entityManager.get(entityId);
    if (!entity) {
      log.warn(`Cannot assign region ${regionId}: entity ${entityId} not found`);
      return false;
    }

    (entity as any).region = regionId;
    log.debug(`Entity ${entityId} assigned to region ${regionId}`);
    return true;
  }

  /**
   * Called when an entity crosses room boundaries so we can detect
   * region transitions (for law/weather/respawn hooks, etc.).
   */
  handleEntityTransfer(
    entityId: string,
    fromRoomId: string,
    toRoomId: string,
  ): void {
    const fromRegion = this.findRegionByRoom(fromRoomId);
    const toRegion = this.findRegionByRoom(toRoomId);

    if (fromRegion?.id !== toRegion?.id) {
      log.info(
        `Entity ${entityId} crossed from region ${
          fromRegion?.id ?? "unknown"
        } → ${toRegion?.id ?? "unknown"}`,
      );
      // TODO: Hook law/weather/respawn triggers here later.
    }
  }

  /**
   * Determines which region owns a given room.
   */
  findRegionByRoom(roomId: string): RegionDefinition | undefined {
    for (const region of this.regions.values()) {
      if (region.zoneIds.includes(roomId)) return region;
    }
    return undefined;
  }

  // ------------------------------------------------------------
  // Respawn Integration
  // ------------------------------------------------------------

  getRespawnPoint(regionId: string): string | undefined {
    return this.regions.get(regionId)?.respawnPoint;
  }

  /**
   * Legacy hook kept for compatibility. The old version called
   * RespawnService.respawnEntity(entity, roomId).
   *
   * The new RespawnService works in terms of (session, character),
   * so this method is now just a thin logging shim — higher layers
   * should call RespawnService directly instead.
   */
  async handleRespawnRequest(entityId: string): Promise<void> {
    const entity = this.entityManager.get(entityId);
    if (!entity) {
      log.warn(`Respawn request failed: entity ${entityId} not found`);
      return;
    }

    const regionId = (entity as any).region as string | undefined;
    const region = regionId ? this.getRegion(regionId) : undefined;

    if (!region) {
      log.warn(
        `Respawn request for entity ${entityId} has no known region; ` +
          `call RespawnService.respawnCharacter(...) directly instead.`,
      );
      return;
    }

    const respawnPoint = region.respawnPoint;
    if (!respawnPoint) {
      log.warn(
        `Region ${region.id} lacks a respawn point for entity ${entityId}`,
      );
      return;
    }

    if (!this.respawnService) {
      log.warn(
        `RespawnService not initialized; cannot respawn ${entityId} at ${respawnPoint}`,
      );
      return;
    }

    // NOTE: We deliberately do NOT try to synthesize a Session/Character
    // here; that logic now lives inside RespawnService + the MUD layer.
    log.info(
      `handleRespawnRequest is deprecated; region=${region.id}, respawnPoint=${respawnPoint}, entity=${entityId}`,
    );
  }

  // ------------------------------------------------------------
  // MMO Backend / Shard Integration
  // ------------------------------------------------------------

  async registerShardLink(shardService: RegionShardService): Promise<void> {
    this.shardService = shardService;
    log.info("Linked RegionManager to shard service");
  }

  async getShardForRegion(regionId: string): Promise<string | undefined> {
    const region = this.regions.get(regionId);
    if (!region) return undefined;

    if (region.shard) return region.shard;
    return this.shardService?.getDefaultShard() ?? "default";
  }
}
