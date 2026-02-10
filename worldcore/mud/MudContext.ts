// worldcore/mud/MudContext.ts

/**
 * Shared dependency bag for all MUD handlers (commands, actions, progression).
 * Constructed from the running WorldServices so command modules can access
 * sessions, world state, and economy facades without ad-hoc imports.
 */

import type { AuctionService } from "../auction/AuctionService";
import type { BankService } from "../bank/BankService";
import type { PostgresCharacterService } from "../characters/PostgresCharacterService";
import type { EntityManager } from "../core/EntityManager";
import type { RoomManager } from "../core/RoomManager";
import type { SessionManager } from "../core/SessionManager";
import type { GuildService } from "../guilds/GuildService";
import type { ItemService } from "../items/ItemService";
import type { MailService } from "../mail/MailService";
import type { NpcManager } from "../npc/NpcManager";
import type { NpcSpawnController } from "../npc/NpcSpawnController";
import type { ServerWorldManager } from "../world/ServerWorldManager";
import type { RespawnService } from "../world/RespawnService";
import type { SpawnHydrator } from "../world/SpawnHydrator";
import type { TownSiegeService } from "../world/TownSiegeService";
import type { TradeService } from "../trade/TradeService";
import type { VendorService } from "../vendors/VendorService";
import type { Session } from "../shared/Session";
import type { WorldServices } from "../world/WorldServices";

export interface MudContextServices {
  sessions: SessionManager;
  guilds: GuildService;

  world?: ServerWorldManager;
  characters?: PostgresCharacterService;
  entities?: EntityManager;
  items?: ItemService;
  rooms?: RoomManager;
  npcs?: NpcManager;
  npcSpawns?: NpcSpawnController;

  mail?: MailService;
  trades?: TradeService;
  vendors?: VendorService;
  bank?: BankService;
  auctions?: AuctionService;

  // v0: wired from server/router so commands like /respawn can use shard-aware respawns
  respawns?: RespawnService;
  // Dev harness: rehydrate POI placeholders from spawn_points
  spawnHydrator?: SpawnHydrator;

  // Short-lived world state
  townSiege?: TownSiegeService;
}

export interface MudContext extends MudContextServices {
  session: Session;
}

export function buildMudContext(
  services:
    | MudContextServices
    | Pick<
        WorldServices,
        | "sessions"
        | "guilds"
        | "world"
        | "characters"
        | "entities"
        | "items"
        | "rooms"
        | "npcs"
        | "npcSpawns"
        | "mail"
        | "trades"
        | "vendors"
        | "bank"
        | "auctions"
        | "respawns"
        | "spawnHydrator"
        | "townSiege"
      >,
  session: Session
): MudContext {
  return {
    session,
    ...services,
  };
}
