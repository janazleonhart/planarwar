// worldcore/world/WorldServices.ts

/**
 * WorldServices is the composition root for shard runtime wiring.
 *
 * It constructs and connects the world/core services listed in the registry
 * (sessions, entities, world manager, movement/streams, NPCs, economy facades)
 * so the MMO server can reuse a single bootstrap for each shard.
 */

import { GuildService } from "../guilds/GuildService";
import { PostgresCharacterService } from "../characters/PostgresCharacterService";
import { ItemService } from "../items/ItemService";
import { PostgresVendorService } from "../vendors/PostgresVendorService";
import { PostgresBankService } from "../bank/PostgresBankService";
import { PostgresAuctionService } from "../auction/PostgresAuctionService";
import { PostgresMailService } from "../mail/PostgresMailService";
import { InMemoryTradeService } from "../trade/InMemoryTradeService";
import { Logger } from "../utils/logger";
import { CombatSystem } from "../core/CombatSystem";
import { EntityManager } from "../core/EntityManager";
import { MessageRouter } from "../core/MessageRouter";
import { MovementEngine } from "../core/MovementEngine";
import { ObjectStream } from "../core/ObjectStream";
import { RoomManager } from "../core/RoomManager";
import { SessionManager } from "../core/SessionManager";
import { TerrainStream } from "../core/TerrainStream";
import { TickEngine } from "../core/TickEngine";
import { DomeBoundary } from "./Boundary";
import { NavGridManager } from "./NavGridManager";
import { RegionManager } from "./RegionManager";
import { RespawnService } from "./RespawnService";
import { ServerWorldManager } from "./ServerWorldManager";
import { SpawnPointService } from "./SpawnPointService";
import { SpawnService } from "./SpawnService";
import { WorldEventBus } from "./WorldEventBus";
import { NpcManager } from "../npc/NpcManager";
import { NpcSpawnController } from "../npc/NpcSpawnController";

import type { AuctionService } from "../auction/AuctionService";
import type { BankService } from "../bank/BankService";
import type { MailService } from "../mail/MailService";
import type { TradeService } from "../trade/TradeService";
import type { VendorService } from "../vendors/VendorService";

const log = Logger.scope("WRE");

export interface WorldServices {
  seed: number;
  shardId: string;

  // Event bus (future use)
  events: WorldEventBus;

  // Core runtime
  sessions: SessionManager;
  entities: EntityManager;
  rooms: RoomManager;
  regions: RegionManager;

  // Spawns / nav / respawn
  spawnPoints: SpawnPointService;
  spawns: SpawnService;
  respawns: RespawnService;
  navGrid: NavGridManager;
  boundary?: DomeBoundary;

  // NPC runtime + DB-backed spawn controller
  npcs: NpcManager;
  npcSpawns: NpcSpawnController;

  // World simulation
  world: ServerWorldManager;
  movement: MovementEngine;
  combat: CombatSystem;
  objectStream: ObjectStream;
  terrainStream: TerrainStream;
  ticks: TickEngine;

  // Economy / meta
  guilds: GuildService;
  characters: PostgresCharacterService;
  items: ItemService;
  trades: TradeService;
  vendors: VendorService;
  bank: BankService;
  auctions: AuctionService;
  mail: MailService;

  // Network entry point
  router: MessageRouter;
}

export interface WorldServicesOptions {
  seed?: number;
  tickIntervalMs?: number;

  /**
   * Optional hook invoked once per world tick.
   * Signature matches TickEngineConfig.onTick.
   */
  onTick?: (nowMs: number, tick: number, deltaMs?: number) => void;
}

/**
 * Bootstraps and wires all world systems into a fully operational runtime.
 * Returns a dependency bag that other layers (MessageRouter, MUD, world ticks)
 * can share instead of re-instantiating individual services.
 */
export async function createWorldServices(
  seedOrOptions?: number | WorldServicesOptions,
): Promise<WorldServices> {
  const options: WorldServicesOptions =
    typeof seedOrOptions === "number"
      ? { seed: seedOrOptions }
      : seedOrOptions ?? {};

  const seed = options.seed ?? 0x1234abcd;
  const tickIntervalMs = options.tickIntervalMs ?? 200;

  log.info(`Initializing Planar War world services (seed=${seed})...`);

  // Event bus (kept minimal for now)
  const events = new WorldEventBus();

  // Core managers
  const sessions = new SessionManager();
  const entities = new EntityManager();
  const world = new ServerWorldManager(seed);

  const blueprint = world.getWorldBlueprint();
  const shardId = blueprint.shardId ?? blueprint.id ?? "prime_shard";

  const rooms = new RoomManager(sessions, entities, world);

  // Spawns / regions / respawns
  const spawnPoints = new SpawnPointService();
  const characters = new PostgresCharacterService();
  const respawns = new RespawnService(world, spawnPoints, characters, entities);

  const regions = new RegionManager({
    entityManager: entities,
    roomManager: rooms,
    respawnService: respawns,
  });

  const navGrid = new NavGridManager(world);

  const spawns = new SpawnService({
    entityManager: entities,
    roomManager: rooms,
    regionManager: regions,
    respawnService: respawns,
  });

  const boundaryState = blueprint.boundary;
  const boundary = boundaryState
    ? DomeBoundary.fromState({
        centerX: boundaryState.centerX,
        centerZ: boundaryState.centerZ,
        radius: boundaryState.radius,
        softRadius: boundaryState.softRadius,
      })
    : undefined;

  // NPC runtime
  const npcs = new NpcManager(entities, sessions);
  const npcSpawns = new NpcSpawnController({
    spawnPoints,
    npcs,
    entities,
  });

  // Items / economy
  const items = new ItemService();
  try {
    await items.loadAll();
  } catch (err) {
    log.warn("ItemService loadAll failed; continuing with empty cache", {
      err,
    });
  }

  const guilds = new GuildService();
  const mail: MailService = new PostgresMailService();
  const trades: TradeService = new InMemoryTradeService();
  const vendors: VendorService = new PostgresVendorService();
  const bank: BankService = new PostgresBankService();
  const auctions: AuctionService = new PostgresAuctionService();

  // Simulation engines
  const movement = new MovementEngine(world);
  const combat = new CombatSystem(entities, rooms, sessions);
  const objectStream = new ObjectStream(world, sessions);
  const terrainStream = new TerrainStream(world, sessions);

  // NOTE: onTick is used by the MMO server to run SongEngine melody ticks.
  const ticks = new TickEngine(
    entities,
    rooms,
    sessions,
    world,
    {
      intervalMs: tickIntervalMs,
      onTick: options.onTick,
    },
    npcs,
  );

  const router = new MessageRouter(
    sessions,
    rooms,
    entities,
    movement,
    combat,
    objectStream,
    terrainStream,
    world,
    guilds,
    characters,
    items,
    npcs,
    mail,
    trades,
    vendors,
    bank,
    auctions,
    npcSpawns,
    respawns,
  );

  log.success(`✅ World runtime services initialized for shard ${shardId}`);

  return {
    seed,
    shardId,
    events,
    sessions,
    entities,
    rooms,
    regions,
    spawnPoints,
    spawns,
    respawns,
    navGrid,
    boundary,
    npcs,
    npcSpawns,
    world,
    movement,
    combat,
    objectStream,
    terrainStream,
    ticks,
    guilds,
    characters,
    items,
    trades,
    vendors,
    bank,
    auctions,
    mail,
    router,
  };
}
