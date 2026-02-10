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
import { SpawnHydrator } from "./SpawnHydrator";
import { applyProfileToPetVitals } from "../pets/PetProfiles";
import { applyPetGearToVitals } from "../pets/PetGear";
import { WorldEventBus } from "./WorldEventBus";
import { TownSiegeService } from "./TownSiegeService";
import { TownSiegeAlarmService } from "./TownSiegeAlarmService";
import { NpcManager } from "../npc/NpcManager";
import { NpcSpawnController } from "../npc/NpcSpawnController";
import { loadPersistedServerBuffs } from "../status/ServerBuffs";

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

  // Short-lived world state
  townSiege: TownSiegeService;
  townSiegeAlarm: TownSiegeAlarmService;

  // Core runtime
  sessions: SessionManager;
  entities: EntityManager;
  rooms: RoomManager;
  regions: RegionManager;

  // Spawns / nav / respawn
  spawnPoints: SpawnPointService;
  spawns: SpawnService;
  respawns: RespawnService;
  spawnHydrator: SpawnHydrator;
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

function envFlag(name: string, defaultValue = false): boolean {
  const v = String(process.env[name] ?? "").trim().toLowerCase();
  if (!v) return defaultValue;
  return v === "1" || v === "true" || v === "yes" || v === "on";
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

  const autoHydrateSpawns = envFlag("WORLD_SPAWNS_ENABLED", false);

  log.info(
    `Initializing Planar War world services (seed=${seed}, WORLD_SPAWNS_ENABLED=${autoHydrateSpawns ? "1" : "0"})...`,
  );

  // Event bus (kept minimal for now)
  const events = new WorldEventBus();
  const townSiege = new TownSiegeService(events);

  // Core managers
  const sessions = new SessionManager();
  const entities = new EntityManager();
  const world = new ServerWorldManager(seed);

  const blueprint = world.getWorldBlueprint();
  const shardId = blueprint.shardId ?? blueprint.id ?? "prime_shard";

  // Spawns
  const spawnPoints = new SpawnPointService();
  const spawnHydrator = new SpawnHydrator(spawnPoints, entities);

  const rooms = new RoomManager(sessions, entities, world, {
    onWorldRoomJoined: async (session, roomId) => {
      // Hydrate POI placeholders for the region the character is *actually* in.
      // Note: session.roomId is a shard/world room, not a region id once the player starts moving.
      const char: any = (session as any).character;
      if (!char) return;

      if (autoHydrateSpawns) {
        const region = world.getRegionAt(char.posX ?? 0, char.posZ ?? 0);
        const regionId = char.lastRegionId ?? region?.id ?? roomId;

        // NOTE: hook expects void | Promise<void>; rehydrateRoom returns a result object.
        await spawnHydrator.rehydrateRoom({
          shardId,
          regionId,
          roomId,
          // no force; per-region cache avoids rehydrating on every join
        });
      }

      // Pet persistence hook (v1): if the character has a persisted active pet,
      // ensure it exists as an entity after joining a world room.
      try {
        const charAny: any = (session as any).character;
        if (!charAny) return;

        const flags: any = charAny?.progression?.flags ?? {};
        const petCfg: any = flags?.pet && typeof flags.pet === "object" ? flags.pet : null;
        if (!petCfg || petCfg.active !== true || petCfg.autoSummon === false) return;

        const owner = entities.getEntityByOwner(session.id);
        if (!owner) return;

        const ownerEntityId = String((owner as any).id ?? "");
        if (!ownerEntityId) return;

        // Enforce single active pet.
        try {
          entities.removePetForOwnerEntityId(ownerEntityId);
        } catch {
          // ignore
        }

        const protoId = String(petCfg.protoId ?? "").trim();
        if (!protoId) return;

        const pet: any = entities.createPetEntity(owner.roomId, protoId, ownerEntityId) as any;
        pet.ownerSessionId = session.id; // owner-only visibility
        pet.petRole = String(petCfg.petRole ?? "").trim() || undefined;
        pet.petClass = String(petCfg.petClass ?? "").trim() || undefined;
        pet.petMode = String(petCfg.mode ?? "defensive");
        pet.followOwner = petCfg.followOwner !== false;

        // Pet gear persistence: attach persisted gear to the pet entity.
        pet.equipment = (petCfg.gear && typeof petCfg.gear === "object") ? petCfg.gear : {};

        try {
          applyProfileToPetVitals(pet);
        } catch {
          // best-effort
        }

        // v1.4: Pet gear affects max HP immediately; damage hooks use cached bonuses.
        try {
          // WorldServices does not own the item service; gear bonuses will be recomputed
          // later when the live mud context (with ctx.items) is available.
          applyPetGearToVitals(pet as any, undefined);
        } catch {
          // best-effort
        }

        // Tell the owning client about their pet (best-effort; visual clients).
        try {
          const r = rooms.get(owner.roomId);
          if (r) {
            sessions.send(session, "entity_spawn" as any, {
              id: pet.id,
              ownerSessionId: session.id,
              entity: pet,
            } as any);
          }
        } catch {
          // ignore
        }
      } catch {
        // Never block join.
      }
    },
  });

  // Siege alarm broadcasts (MUD UX hook)
  const townSiegeAlarm = new TownSiegeAlarmService(events, rooms);

  // Respawns / regions
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
  
  // Wire optional WorldEventBus into NPC runtime for siege/pressure signals.
  try {
    npcs.attachEventBus(events);
  } catch {
    // best-effort
  }

  // Wire optional siege state into NPC runtime for siege-aware behaviors.
  try {
    npcs.attachTownSiegeService(townSiege);
  } catch {
    // best-effort
  }
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

  // Load persisted server-wide buffs early so TickEngine can sync them to players.
  // Safe in unit tests (no-op).
  try {
    const loaded = await loadPersistedServerBuffs(Date.now());
    if (loaded > 0) {
      log.info("Loaded persisted server buffs", { count: loaded });
    }
  } catch (err) {
    log.warn("Failed to load persisted server buffs; continuing", { err });
  }

  // Wire canonical NPC death pipeline services (DOT ticks must award XP/loot too).
  try {
    (npcs as any).attachDeathPipelineServices?.({
      rooms,
      characters,
      items,
      mail,
    });
  } catch {
    // ignore
  }

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
    spawnHydrator,
    respawns,
  );

  log.success(`✅ World runtime services initialized for shard ${shardId}`);

  return {
    seed,
    shardId,
    events,
    townSiege,
    townSiegeAlarm,
    sessions,
    entities,
    rooms,
    regions,
    spawnPoints,
    spawns,
    respawns,
    spawnHydrator,
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
