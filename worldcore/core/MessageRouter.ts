//worldcore/core/MessageRouter.ts

import { SessionManager } from "./SessionManager";
import { RoomManager } from "./RoomManager";
import { EntityManager } from "./EntityManager";
import { Session } from "../shared/Session";
import { ClientMessage } from "../shared/messages";
import { Logger } from "../utils/logger";
import { db } from "../db/Database";
import { normalizeRegionIdForDb } from "../world/RegionFlags";

import { ServerWorldManager } from "../world/ServerWorldManager";
import { handleMudCommand } from "../mud/MudCommandHandler";
import { buildMudContext } from "../mud/MudContext";
import { GuildService } from "../guilds/GuildService";
import { PostgresCharacterService } from "../characters/PostgresCharacterService";
import { NpcManager } from "../npc/NpcManager";
import { NpcSpawnController } from "../npc/NpcSpawnController";
import { performAction } from "../actions/WorldActionService";
import { PostgresMailService } from "../mail/PostgresMailService";
import { MailService } from "../mail/MailService";
import { InMemoryTradeService } from "../trade/InMemoryTradeService";
import { TradeService } from "../trade/TradeService";
import { PostgresVendorService } from "../vendors/PostgresVendorService";
import { PostgresBankService } from "../bank/PostgresBankService";
import { PostgresAuctionService } from "../auction/PostgresAuctionService";
import { RespawnService } from "../world/RespawnService";
import type { SpawnHydrator } from "../world/SpawnHydrator";
import type { TownSiegeService } from "../world/TownSiegeService";

import type { ActionRequest } from "../actions/ActionTypes";
import type { WhereAmIResultPayload } from "../shared/messages";
import type { ClientMovePayload, ResolvedMove } from "./MovementEngine";
import type { ItemService } from "../items/ItemService";
import type { VendorService } from "../vendors/VendorService";
import type { BankService } from "../bank/BankService";
import type { AuctionService } from "../auction/AuctionService";

// Light-weight facades so world/network systems can plug in without
// worldcore importing their concrete implementations.
export interface CombatFacade {
  setTarget?(session: Session, targetId: string): void;
  handleCast?(session: Session, payload: any): void;
}

export interface ObjectStreamFacade {
  handleObjectRequest(session: Session, payload: any): void;
}

export interface TerrainStreamFacade {
  handleChunkRequest(session: Session, payload: any): void;
  handleTerrainEnvelope(session: Session, payload: any): void;
}

export interface MovementEngineFacade {
  applyClientMove(
    session: Session,
    payload: ClientMovePayload
  ): ResolvedMove | null;
}

export type MudResultEvent = "death" | "respawn";

/**
 * Infer MUD lifecycle events from the input + resulting text.
 *
 * - respawn: inferred from the explicit command verb "respawn" (stable).
 * - death: inferred from the canonical "You die." marker (combat pipeline).
 */
export function inferMudResultEvent(
  input: string,
  replyText: string
): MudResultEvent | undefined {
  const cmd = String(input ?? "").trim().toLowerCase();
  const verb = (cmd.split(/\s+/)[0] ?? "").trim();
  const txt = String(replyText ?? "");

  if (verb === "respawn") {
    // Only emit a respawn event when the command actually succeeded.
    if (txt.startsWith("You are not dead")) return;
    if (txt.startsWith("You cannot respawn")) return;

    return "respawn";
  }

  if (txt.includes("You die.")) return "death";
  
  // Fallback must stay strict: only "die." (not broad 'die' matching).
  if (/\bdie\./i.test(txt)) return "death";

  return undefined;
}


const log = Logger.scope("ROUTER");

export class MessageRouter {
  constructor(
    private readonly sessions: SessionManager,
    private readonly rooms: RoomManager,
    private readonly entities: EntityManager,
    private readonly movement?: MovementEngineFacade,
    private readonly combat?: CombatFacade,
    private readonly objectStream?: ObjectStreamFacade,
    private readonly terrainStream?: TerrainStreamFacade,
    private readonly world?: ServerWorldManager,
    private readonly guilds = new GuildService(),
    private readonly characters?: PostgresCharacterService,
    private readonly items?: ItemService,
    private readonly npcs?: NpcManager,
    private readonly mail?: MailService,
    private readonly trades?: TradeService,
    private readonly vendors?: VendorService,
    private readonly bank?: BankService,
    private readonly auctions?: AuctionService,
    private readonly npcSpawns?: NpcSpawnController,
    // Dev harness: POI hydration from spawn_points
    private readonly spawnHydrator?: SpawnHydrator,
    // NEW: shard-aware respawn service (graveyards / hubs)
    private readonly respawns?: RespawnService,
    // Short-lived world state: used by MUD service gating (vendor lockdown)
    private readonly townSiege?: TownSiegeService,
  ) {}

  async handleRawMessage(session: Session, data: any): Promise<any> {
    const rawType = typeof data;
    const rawPreview =
      rawType === "string"
        ? (data as string).slice(0, 256)
        : Buffer.isBuffer(data)
          ? data.toString("utf8", 0, Math.min(256, data.length))
          : String(data);

    log.debug("handleRawMessage: received", {
      sessionId: session.id,
      roomId: session.roomId,
      rawType,
      rawLength: rawType === "string" ? (data as string).length : undefined,
      preview: rawPreview,
    });

    let msg: ClientMessage;

    try {
      const raw = typeof data === "string" ? data : data.toString("utf8" as any);
      msg = JSON.parse(raw);
    } catch (err) {
      log.warn("Failed to parse client message", {
        sessionId: session.id,
        err,
        rawPreview,
      });
      this.sessions.send(session, "error", { code: "bad_json" });
      return;
    }

    if (!msg || typeof msg.op !== "string") {
      log.warn("Bad message shape", { sessionId: session.id, msg });
      this.sessions.send(session, "error", { code: "bad_message_shape" });
      return;
    }

    const { op, payload = {}, roomId } = msg as any;

    // Mark activity for heartbeat
    this.sessions.touch(session.id);

    log.info("Routing message", {
      sessionId: session.id,
      roomId: session.roomId,
      op,
      payloadKeys: Object.keys(payload || {}),
      explicitRoomId: roomId ?? null,
    });

    switch (op) {
      case "ping": {
        this.sessions.send(session, "pong", { t: Date.now() });
        break;
      }

      case "hello": {
        this.sessions.send(session, "welcome", {
          sessionId: session.id,
          displayName: session.displayName,
        });
        break;
      }

      case "join_room": {
        const requested = String(roomId || payload.roomId || "lobby");

        // World/visibility membership is server-authoritative once a character is attached.
        // Keep opcode for backwards compatibility, but deny in-world.
        if ((session as any).character) {
          log.warn("join_room denied (in-world)", {
            sessionId: session.id,
            requested,
          });
          this.sessions.send(session, "error", {
            code: "join_room_denied_in_world",
          });
          break;
        }

        // Only allow safe UI rooms pre-world.
        const allowed = new Set(["lobby", "auth", "select_character"]);
        const id = allowed.has(requested) ? requested : "lobby";

        log.info("join_room allowed (pre-world)", {
          sessionId: session.id,
          targetRoom: id,
          requested,
        });

        this.rooms.joinRoom(session, id);
        this.sessions.send(session, "room_joined", { roomId: id });
        break;
      }

      case "leave_room": {
        // Same principle: clients shouldn't be able to drop world subscriptions directly.
        if ((session as any).character) {
          log.warn("leave_room denied (in-world)", {
            sessionId: session.id,
          });
          this.sessions.send(session, "error", {
            code: "leave_room_denied_in_world",
          });
          break;
        }

        log.info("leave_room allowed (pre-world)", { sessionId: session.id });
        this.rooms.leaveRoom(session);
        this.sessions.send(session, "room_left", {});
        break;
      }

      case "list_rooms": {
        const list = this.rooms.listRooms();
        this.sessions.send(session, "room_list", { rooms: list });
        break;
      }

      // ---------------------------------------------------------
      // OBJECT / TERRAIN STREAMING
      // ---------------------------------------------------------
      case "object_request": {
        log.debug("object_request", { sessionId: session.id, payload });

        if (!this.objectStream) {
          this.sessions.send(session, "error", {
            code: "object_stream_unavailable",
          });
          break;
        }

        this.objectStream.handleObjectRequest(session, payload);
        break;
      }

      case "terrain_request": {
        log.debug("terrain_request", { sessionId: session.id, payload });

        if (!this.terrainStream) {
          this.sessions.send(session, "error", {
            code: "terrain_stream_unavailable",
          });
          break;
        }

        this.terrainStream.handleChunkRequest(session, payload);
        break;
      }

      case "terrain": {
        log.debug("terrain envelope", { sessionId: session.id, payload });

        if (!this.terrainStream) {
          this.sessions.send(session, "error", {
            code: "terrain_stream_unavailable",
          });
          break;
        }

        this.terrainStream.handleTerrainEnvelope(session, payload);
        break;
      }

      // ---------------------------------------------------------
      // MOVEMENT
      // ---------------------------------------------------------
      case "move":
      case "walk":
      case "go": {
        if (!this.movement) {
          this.sessions.send(session, "error", {
            code: "unimplemented_op",
            op,
          });
          break;
        }

        const resolved = this.movement.applyClientMove(
          session,
          payload as ClientMovePayload
        );

        if (!resolved) {
          this.sessions.send(session, "error", { code: "bad_move" });
          break;
        }

        const entity = this.entities.getEntityByOwner(session.id);
        if (!entity) {
          log.warn("move: no entity for session", {
            sessionId: session.id,
            resolved,
          });
          this.sessions.send(session, "error", { code: "no_entity" });
          break;
        }

        // Update server-authoritative transform
        entity.x = resolved.x;
        entity.y = resolved.y;
        entity.z = resolved.z;
        entity.rotY = resolved.rotY;

        const roomIdEffective = session.roomId;
        if (!roomIdEffective) {
          log.debug("move: session not in room", {
            sessionId: session.id,
          });
          break;
        }

        const room = this.rooms.get(roomIdEffective);
        if (!room) {
          log.warn("move: room not found", {
            sessionId: session.id,
            roomId: roomIdEffective,
          });
          this.sessions.send(session, "error", { code: "room_not_found" });
          break;
        }

        // Broadcast updated transform to everyone else
        room.broadcastExcept(session.id, "entity_update", {
          id: entity.id,
          ownerSessionId: session.id,
          x: entity.x,
          y: entity.y,
          z: entity.z,
          rotY: entity.rotY,
          t: Date.now(),
        });

        // Optional: we *could* echo back to the sender as well if we want
        // a strict server-confirmation pattern. For now, we rely on the
        // client using this as reconciliation only if needed.
        break;
      }

      // ---------------------------------------------------------
      // GENERIC WORLD ACTIONS (attack, harvest, etc.)
      // ---------------------------------------------------------
      case "action": {
        const char = session.character;
        if (!char) {
          this.sessions.send(session, "error", {
            code: "no_character",
            op,
          });
          break;
        }

        const payload = msg.payload || {};
        const kind = String(payload.kind || "");

        if (kind !== "attack" && kind !== "harvest") {
          this.sessions.send(session, "error", {
            code: "invalid_action_kind",
            op,
            kind,
          });
          break;
        }

        // Build a typed ActionRequest from the payload
        const actionReq: ActionRequest =
          kind === "attack"
            ? {
                kind: "attack",
                channel: (payload.channel as any) || "weapon",
                targetId:
                  typeof payload.targetId === "string"
                    ? payload.targetId
                    : undefined,
                targetName:
                  typeof payload.targetName === "string"
                    ? payload.targetName
                    : undefined,
              }
            : {
                kind: "harvest",
                resourceType:
                  typeof payload.resourceType === "string"
                    ? payload.resourceType
                    : undefined,
                targetId:
                  typeof payload.targetId === "string"
                    ? payload.targetId
                    : undefined,
                targetName:
                  typeof payload.targetName === "string"
                    ? payload.targetName
                    : undefined,
              };

        performAction(
          {
            // WorldActionContext = loose bag; we give it the same stuff
            // MudCommandHandler expects.
            session,
            sessions: this.sessions,
            rooms: this.rooms,
            entities: this.entities,
            world: this.world,
            characters: this.characters,
            items: this.items,
            guilds: this.guilds,
            npcs: this.npcs,
            mail: this.mail,
            trades: this.trades,
            vendors: this.vendors,
            bank: this.bank,
            auctions: this.auctions,
          },
          char,
          actionReq
        )
          .then((result) => {
            this.sessions.send(session, "action_result", {
              ok: true,
              kind,
              messages: result.messages,
            });
          })
          .catch((err) => {
            log.error("action op failed", {
              err,
              sessionId: session.id,
              op,
              payload,
            });
            this.sessions.send(session, "action_result", {
              ok: false,
              kind,
              messages: ["An error occurred."],
            });
          });

        break;
      }

      case "set_target": {
        log.info("set_target op received", {
          sessionId: session.id,
          payload,
        });

        if (this.combat?.setTarget) {
          this.combat.setTarget(session, payload.targetId);
        } else {
          this.sessions.send(session, "error", {
            code: "unimplemented_op",
            op,
          });
        }
        break;
      }

      case "cast": {
        log.info("cast op received", {
          sessionId: session.id,
          payload,
        });

        if (this.combat?.handleCast) {
          this.combat.handleCast(session, payload);
        } else {
          this.sessions.send(session, "error", {
            code: "unimplemented_op",
            op,
          });
        }
        break;
      }

      // ---------------------------------------------------------
      // CHAT
      // ---------------------------------------------------------
      case "chat": {
        const text = String(payload.text ?? "").slice(0, 512);
        if (!text) break;

        const roomIdEffective = session.roomId;
        if (!roomIdEffective) {
          this.sessions.send(session, "error", { code: "not_in_room" });
          break;
        }

        const room = this.rooms.get(roomIdEffective);
        if (!room) {
          this.sessions.send(session, "error", { code: "room_not_found" });
          break;
        }

        room.broadcast("chat", {
          from: session.displayName,
          sessionId: session.id,
          text,
          t: Date.now(),
        });

        break;
      }

      // ---------------------------------------------------------
      // HEARTBEAT
      // ---------------------------------------------------------
      case "heartbeat": {
        session.lastSeen = Date.now();
        this.sessions.send(session, "pong", { t: Date.now() });
        break;
      }

      // ---------------------------------------------------------
      // MUD
      // ---------------------------------------------------------
      case "whereami": {
        void this.handleWhereAmI(session);
        break;
      }

      case "mud": {
        const char = session.character;
        if (!char) return;

        const text = String(msg.payload?.text ?? "");

        const mudCtx = buildMudContext(
          {
            sessions: this.sessions,
            guilds: this.guilds,
            world: this.world,
            characters: this.characters,
            entities: this.entities,
            items: this.items,
            rooms: this.rooms,
            npcs: this.npcs,
            npcSpawns: this.npcSpawns,
            mail: this.mail,
            trades: this.trades,
            vendors: this.vendors,
            bank: this.bank,
            auctions: this.auctions,
            // NEW: wire RespawnService into the MUD context
            respawns: this.respawns,
            spawnHydrator: this.spawnHydrator,
            townSiege: this.townSiege,
          },
          session
        );

        handleMudCommand(char, text, this.world, mudCtx)
          .then((reply) => {
            if (reply !== null) {
              const replyText = String(reply ?? "");
const event = inferMudResultEvent(text, replyText);
const mudPayload: any = { text: replyText };
if (event) mudPayload.event = event;
this.sessions.send(session, "mud_result", mudPayload);
            }
          })
          .catch((err) => {
            log.error("MUD command failed", {
              err,
              sessionId: session.id,
              input: text,
            });
            this.sessions.send(session, "mud_result", {
              text: "An error occurred.",
            });
          });

        break;
      }

      // ---------------------------------------------------------
      // GUILD
      // ---------------------------------------------------------
      case "gchat": {
        const char = session.character;
        if (!char) {
          this.sessions.send(session, "error", { code: "not_in_guild" });
          break;
        }

        const text = String(payload.text ?? "").slice(0, 512);
        if (!text) break;

        this.guilds
          .getGuildForCharacter(char.id)
          .then((guild) => {
            log.info("Sending guild chat", {
              guildId: guild.id,
              from: char.name,
              text,
            });

            if (!guild) {
              this.sessions.send(session, "error", {
                code: "not_in_guild",
              });
              return;
            }

            // CRITICAL: hydrate cached character state
            char.guildId = guild.id;

            for (const s of this.sessions.getAllSessions()) {
              if (s.character?.guildId === guild.id) {
                this.sessions.send(s, "chat", {
                  from: `${char.name} <${guild.tag}>`,
                  text,
                  t: Date.now(),
                });
              }
            }
          })
          .catch((err) => {
            log.error("gchat failed", { err, charId: char.id });
            this.sessions.send(session, "error", { code: "guild_error" });
          });

        break;
      }

      default: {
        log.warn("Unhandled op", { sessionId: session.id, op, payload });
        this.sessions.send(session, "error", {
          code: "unknown_op",
          op,
        });
        break;
      }
    }
  }

  async handleWhereAmI(session: Session): Promise<void> {
    // Start from the session's view of the world
    let roomId: string | null = session.roomId ?? null;
    let x = 0;
    let y = 0;
    let z = 0;

    if (session.character) {
      // Prefer the authoritative character position if it's present
      x = session.character.posX ?? 0;
      y = session.character.posY ?? 0;
      z = session.character.posZ ?? 0;

      if (!roomId && (session.character as any).roomId) {
        roomId = (session.character as any).roomId;
      }
    } else {
      // Fallback: use the player entity bound to this session
      const entity = this.entities.getEntityByOwner(session.id);
      if (entity) {
        x = (entity as any).x ?? 0;
        y = (entity as any).y ?? 0;
        z = (entity as any).z ?? 0;

        if (!roomId && (entity as any).roomId) {
          roomId = (entity as any).roomId;
        }
      }
    }

    // Resolve region, if we have a world with region queries
    let regionId: string | null = null;
    if (this.world && typeof this.world.getRegionAt === "function") {
      const region = this.world.getRegionAt(x, z);
      regionId = region?.id ?? null;
    }

    // Prefer the actual world id if we have a world manager; otherwise
    // fall back to the prototype shard id.
    const shardId = this.world?.getWorldBlueprint().id ?? "prime_shard";


    // Best-effort: enrich with DB-backed region metadata (name/kind/flags).
    // This is primarily for debugging (PvP/event/warfront toggles) and must never hard-fail.
    let regionName: string | undefined;
    let regionKind: string | undefined;
    let regionFlags: Record<string, unknown> | undefined;

    if (regionId) {
      const dbRegionId = normalizeRegionIdForDb(regionId);
      try {
        const res = await db.query(
          `SELECT name, kind, flags FROM regions WHERE shard_id = $1 AND region_id = $2 LIMIT 1`,
          [shardId, dbRegionId]
        );

        const row = (res.rows?.[0] ?? null) as any;
        if (row) {
          regionName = row.name ?? undefined;
          regionKind = row.kind ?? undefined;
          if (row.flags && typeof row.flags === "object") {
            regionFlags = row.flags as Record<string, unknown>;
          }
        }
      } catch (err: any) {
        log.debug("whereami region metadata lookup failed", {
          shardId,
          regionId: dbRegionId,
          err: err?.message ?? String(err),
        });
      }
    }
    const payload: WhereAmIResultPayload = {
      shardId,
      roomId,
      x,
      y,
      z,
      regionId,
      regionName,
      regionKind,
      regionFlags,
    };

    this.sessions.send(session, "whereami_result", payload);
  }
}