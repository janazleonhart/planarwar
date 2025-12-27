//worldcore/mud/MudContext.ts

import { ServerWorldManager } from "../world/ServerWorldManager";
import { SessionManager } from "../core/SessionManager";
import { Session } from "../shared/Session";
import { GuildService } from "../guilds/GuildService";
import { PostgresCharacterService } from "../characters/PostgresCharacterService";
import { EntityManager } from "../core/EntityManager";
import { RoomManager } from "../core/RoomManager";
import { NpcManager } from "../npc/NpcManager";
import { TradeService } from "../trade/TradeService";

import type { ItemService } from "../items/ItemService";
import type { VendorService } from "../vendors/VendorService";
import type { BankService } from "../bank/BankService";
import type { AuctionService } from "../auction/AuctionService";
import type { MailService } from "../mail/MailService";

export type MudContext = {
    sessions: SessionManager;
    guilds: GuildService;
    session: Session;
    world?: ServerWorldManager;
    characters?: PostgresCharacterService;
    entities?: EntityManager;
    items?: ItemService;
    rooms?: RoomManager;
    npcs?: NpcManager; 
    mail?: MailService;
    trades?: TradeService;
    vendors?: VendorService; 
    bank?: BankService;
    auctions?: AuctionService; 
  };