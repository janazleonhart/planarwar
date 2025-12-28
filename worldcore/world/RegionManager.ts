// worldcore/world/RegionManager.ts
// ------------------------------------------------------------
// Purpose:
// Governs world regions, zones, and shard-aware spatial ownership.
// Serves as the authoritative registry connecting RoomManager,
// ServerWorldManager, and MMO backend services (such as persistence,
// respawn, and player session routing).
//
// This module ensures region-based control of entities, room clusters,
// respawn logic, and cross-zone transitions. It provides APIs for both
// local world logic and higher-level MMO backend operations.
// ------------------------------------------------------------

import { RoomManager } from "../core/RoomManager";
import { EntityManager } from "../core/EntityManager";
import { RespawnService } from "./RespawnService";
import { Logger } from "../utils/logger";

import type { ShardService } from "../../mmo-backend/ShardService";
import type { PlayerSession } from "../../mmo-backend/PlayerSession";

const log = Logger.scope("REGION");

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export type RegionDefinition = {
  id: string;
  name: string;
  zoneIds: string[];
  shard?: string;           // Optional for multi-shard deployments
  lawLevel?: number;        // Law intensity or enforcement index
  respawnPoint?: string;    // Default respawn room
  weather?: string;         // Optional visual/environmental flavor
};

// ------------------------------------------------------------
// RegionManager
// ------------------------------------------------------------

export class RegionManager {
  private regions: Map<string, RegionDefinition> = new Map();
  private entityManager: EntityManager;
  private roomManager: RoomManager;
  private respawnService?: RespawnService;
  private shardService?: ShardService;

  constructor(opts: {
    entityManager: EntityManager;
    roomManager: RoomManager;
    respawnService?: RespawnService;
    shardService?: ShardService;
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

  // Called when entity crosses zone boundaries
  handleEntityTransfer(entityId: string, fromRoomId: string, toRoomId: string): void {
    const fromRegion = this.findRegionByRoom(fromRoomId);
    const toRegion = this.findRegionByRoom(toRoomId);

    if (fromRegion?.id !== toRegion?.id) {
      log.info(
        `Entity ${entityId} crossed from region ${fromRegion?.id ?? "unknown"} → ${toRegion?.id ?? "unknown"}`
      );

      // TODO: Hook in law/weather/respawn triggers here
      // Example: this.applyLawTransition(entityId, fromRegion, toRegion);
    }
  }

  // Determines which region owns a given room
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

  async handleRespawnRequest(entityId: string): Promise<void> {
    const entity = this.entityManager.get(entityId);
    if (!entity) {
      log.warn(`Respawn request failed: entity ${entityId} not found`);
      return;
    }

    const region = this.getRegion((entity as any).region);
    if (!region) {
      log.warn(`Respawn request failed: entity ${entityId} has no region assigned`);
      return;
    }

    if (!this.respawnService) {
      log.warn(`RespawnService not initialized; cannot respawn ${entityId}`);
      return;
    }

    const respawnPoint = region.respawnPoint;
    if (respawnPoint) {
      await this.respawnService.respawnEntity(entity, respawnPoint);
      log.info(`Entity ${entityId} respawned in region ${region.id}`);
    } else {
      log.warn(`Region ${region.id} lacks a respawn point for entity ${entityId}`);
    }
  }

  // ------------------------------------------------------------
  // MMO Backend / Shard Integration
  // ------------------------------------------------------------

  async registerShardLink(shardService: ShardService): Promise<void> {
    this.shardService = shardService;
    log.info("Linked RegionManager to MMO ShardService");
  }

  async getShardForRegion(regionId: string): Promise<string | undefined> {
    const region = this.regions.get(regionId);
    if (!region) return undefined;
    return region.shard ?? (this.shardService?.getDefaultShard() ?? "default");
  }
}
