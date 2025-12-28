// worldcore/world/WorldServices.ts
// ------------------------------------------------------------
// Purpose:
// Complete initialization layer for the Planar War Runtime Environment (WRE)
// with shard-aware injection, fully aligned constructors, and
// structured logger outputs for boot diagnostics.
// ------------------------------------------------------------

import { Logger } from "../utils/logger";

// Core Systems
import { SessionManager } from "../core/SessionManager";
import { EntityManager } from "../core/EntityManager";
import { RoomManager } from "../core/RoomManager";
import { CombatSystem } from "../core/CombatSystem";
import { MovementEngine } from "../core/MovementEngine";
import { ObjectStream } from "../core/ObjectStream";
import { TerrainStream } from "../core/TerrainStream";
import { MessageRouter } from "../core/MessageRouter";
import { TickEngine } from "../core/TickEngine";

// World Systems
import { ServerWorldManager } from "./ServerWorldManager";
import { RegionManager } from "./RegionManager";
import { SpawnService } from "./SpawnService";
import { RespawnService } from "./RespawnService";
import { SpawnPointService } from "./SpawnPointService";
import { NavGridManager } from "./NavGridManager";
import { Boundary } from "./Boundary";
import { WorldEventBus } from "./WorldEventBus";

// Optional NPC and world-level managers
import { NpcManager } from "../npc/NpcManager";

const log = Logger.scope("WRE");

export interface WorldServices {
  shardId?: number;
  events: WorldEventBus;
  sessions: SessionManager;
  entities: EntityManager;
  rooms: RoomManager;
  regions: RegionManager;
  spawns: SpawnService;
  respawns: RespawnService;
  navGrid: NavGridManager;
  boundary: Boundary;
  npcs: NpcManager;
  world: ServerWorldManager;
  movement: MovementEngine;
  combat: CombatSystem;
  objectStream: ObjectStream;
  terrainStream: TerrainStream;
  ticks: TickEngine;
  router: MessageRouter;
}

/** Bootstraps and wires all world systems into a fully operational runtime. */
export function createWorldServices(shardId?: number): WorldServices {
  log.info(`Initializing Planar War WRE (Shard ${shardId ?? 0})...`);

  // --- Core Base Managers ---
  const events = new WorldEventBus();
  log.info("WorldEventBus created.");

  const sessions = new SessionManager();
  log.success("SessionManager initialized.");

  const entities = new EntityManager();
  log.success("EntityManager initialized.");

  const rooms = new RoomManager(sessions, entities);
  log.success("RoomManager linked to SessionManager and EntityManager.");

  // --- World Layer ---
  const world = new ServerWorldManager(shardId ?? 0, events);
  log.success("ServerWorldManager online.");

  const regions = new RegionManager(world, events);
  const boundary = new Boundary(regions);
  const navGrid = new NavGridManager(regions);
  log.success("RegionManager, Boundary, and NavGridManager linked.");

  const respawns = new RespawnService(entities, rooms, regions, world);
  const spawns = new SpawnService(entities, rooms, respawns, world);
  const spawnPoints = new SpawnPointService(world, spawns);
  log.success("Spawn and Respawn services registered.");

  // --- NPCs and World Entities ---
  const npcs = new NpcManager(events, entities, regions);
  log.success("NpcManager ready.");

  // --- Core Systems Integration ---
  const movement = new MovementEngine(world);
  const combat = new CombatSystem(entities, rooms, sessions);
  log.success("MovementEngine and CombatSystem initialized.");

  const objectStream = new ObjectStream(world, sessions);
  const terrainStream = new TerrainStream(world, sessions);
  log.success("Object and Terrain streams activated.");

  const ticks = new TickEngine(entities, rooms, sessions, world, { intervalMs: 200 }, npcs);
  log.success("TickEngine running (200ms interval).");

  const router = new MessageRouter(
    sessions,
    rooms,
    entities,
    movement,
    combat,
    objectStream,
    terrainStream,
    world,
    spawns,
    npcs
  );
  log.success("MessageRouter operational.");

  log.success(`✅ World Runtime Environment initialized for Shard ${shardId ?? 0}.`);

  return {
    shardId,
    events,
    sessions,
    entities,
    rooms,
    regions,
    spawns,
    respawns,
    navGrid,
    boundary,
    npcs,
    world,
    movement,
    combat,
    objectStream,
    terrainStream,
    ticks,
    router,
  };
}
