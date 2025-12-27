// mmo-backend/server.ts

import http from "http";
import { WebSocketServer, WebSocket } from "ws";

import { Logger } from "../worldcore/utils/logger";
import { SessionManager } from "../worldcore/core/SessionManager";
import { RoomManager } from "../worldcore/core/RoomManager";
import { EntityManager } from "../worldcore/core/EntityManager";
import { MessageRouter } from "../worldcore/core/MessageRouter";
import { CombatSystem } from "../worldcore/core/CombatSystem";
import { ServerWorldManager } from "../worldcore/world/ServerWorldManager";
import { startHeartbeat } from "../worldcore/core/Heartbeat";
import { TickEngine } from "../worldcore/core/TickEngine";
import { TerrainStream } from "../worldcore/core/TerrainStream";
import { ObjectStream } from "../worldcore/core/ObjectStream";
import { MovementEngine } from "../worldcore/core/MovementEngine";
import { NavGridManager } from "../worldcore/world/NavGridManager";
import { PostgresAuthService } from "../worldcore/auth/PostgresAuthService";
import { AttachedIdentity } from "../worldcore/shared/AuthTypes";
import { PostgresCharacterService } from "../worldcore/characters/PostgresCharacterService";
import { CharacterState } from "../worldcore/characters/CharacterTypes";
import { GuildService } from "../worldcore/guilds/GuildService";
import { hydrateCharacterRegion } from "../worldcore/characters/CharacterStateGuard";
import { ItemService } from "../worldcore/items/ItemService";
import { NpcManager } from "../worldcore/npc/NpcManager";
import { SpawnPointService } from "../worldcore/world/SpawnPointService";
import { NpcSpawnController } from "../worldcore/npc/NpcSpawnController";
import { RespawnService } from "../worldcore/world/RespawnService";
import { PostgresMailService } from "../worldcore/mail/PostgresMailService";
import { TradeService } from "../worldcore/trade/TradeService";
import { PostgresVendorService } from "../worldcore/vendors/PostgresVendorService";
import { PostgresBankService } from "../worldcore/bank/PostgresBankService";
import { PostgresAuctionService } from "../worldcore/auction/PostgresAuctionService";
import { netConfig } from "./config";
import { InMemoryTradeService } from "../worldcore/trade/InMemoryTradeService";
import { PostgresQuestService } from "../worldcore/quests/PostgresQuestService";
import { setQuestDefinitions } from "../worldcore/quests/QuestRegistry";
import { PostgresNpcService } from "../worldcore/npc/PostgresNpcService";
import { setNpcPrototypes } from "../worldcore/npc/NpcTypes";

import type { MudContext } from "../worldcore/mud/MudContext";
import { tickSongsForCharacter } from "../worldcore/songs/SongEngine";

const log = Logger.scope("SERVER");

function describeSocket(ws: WebSocket): string {
  const sock: any = ws;
  const r = sock?._socket;
  if (!r) return "";
  return `${r.remoteAddress || "?"}:${r.remotePort || "?"}`;
}

function main() {
  log.info("Starting MMO shard server...", {
    host: netConfig.host,
    port: netConfig.port,
    path: netConfig.path,
  });

  // Core managers
  const sessions = new SessionManager();
  const entities = new EntityManager();
  const world = new ServerWorldManager(); // uses prime shard demo for now
  const rooms = new RoomManager(sessions, entities, world);

  // Nav grid manager (stub for now)
  const navGrid = new NavGridManager(world);
  navGrid.init().catch((err) => {
    log.warn("NavGridManager init failed", { err });
  });

  // Combat system (stub, but wired)
  const combat = new CombatSystem(entities, rooms, sessions);

  // Movement engine (server-authoritative Y)
  const movement = new MovementEngine(world);

  // Terrain + object streams
  const terrainStream = new TerrainStream(world, sessions);
  const objectStream = new ObjectStream(world, sessions);

  // Auth service
  const auth = new PostgresAuthService();

  // Character service (Postgres-backed)
  const characters = new PostgresCharacterService();

  // Guild Service (Postgres-backed)
  const guilds = new GuildService();

  // Items (Postgres-backed, shared between MMO + city builder later)
  const items = new ItemService();
  items.loadAll().catch((err) => {
    log.error("ItemService loadAll failed", { err });
  });

  // NPC manager
  const npcs = new NpcManager(entities);

  // DB-driven spawn points + controller
  const spawnPoints = new SpawnPointService();
  const npcSpawns = new NpcSpawnController(spawnPoints, npcs, entities);

  // Respawn service
  const respawnService = new RespawnService(world, spawnPoints, characters, entities);

  // Mail Service
  const mailService = new PostgresMailService();

  // Trade Service
  const tradeService: TradeService = new InMemoryTradeService();

  // Vendor Service
  const vendorService = new PostgresVendorService();

  // Bank Service
  const bankService = new PostgresBankService();

  // Auction Service
  const auctionService = new PostgresAuctionService();

  // Quest Service (Postgres-backed, shared across MUD / 2.5D / city builder)
  const questService = new PostgresQuestService();
  questService
    .listQuests()
    .then((defs) => {
      if (defs.length > 0) {
        setQuestDefinitions(defs);
        log.success("Loaded quests from Postgres", { count: defs.length });
      } else {
        log.info(
          "No quests found in Postgres; using hardcoded quest definitions."
        );
      }
    })
    .catch((err) => {
      log.warn(
        "Failed to load quests from Postgres; falling back to hardcoded quest definitions.",
        { err }
      );
    });

  // NPC Service
  const npcService = new PostgresNpcService();
  npcService
    .listNpcs()
    .then((protos) => {
      if (protos.length > 0) {
        setNpcPrototypes(protos);
        log.success("Loaded NPC prototypes from Postgres", {
          count: protos.length,
        });
      } else {
        log.info(
          "No NPC prototypes found in Postgres; using hardcoded defaults."
        );
      }
    })
    .catch((err) => {
      log.warn(
        "Failed to load NPC prototypes from Postgres; using hardcoded defaults.",
        { err }
      );
    });

  // Personal resource respawn loop (ore/herbs/etc.)
  const personalRefreshInFlight = new Set<string>();
  setInterval(async () => {
    for (const s of sessions.values() as Iterable<any>) {
      const ch: CharacterState | undefined = (s as any).character;
      if (!ch) continue;

      const roomId = s.roomId;
      if (!roomId) continue;

      const shardId = ch.shardId ?? "prime_shard";
      const regionId = ch.lastRegionId ?? (ch as any).regionId ?? roomId;
      const key = `${roomId}:${s.id}`;

      if (personalRefreshInFlight.has(key)) continue;
      personalRefreshInFlight.add(key);

      try {
        // Snapshot current personal nodes visible to this session
        const before = new Set(
          entities
            .getEntitiesInRoom(roomId)
            .filter(
              (e: any) =>
                e.ownerSessionId === s.id &&
                (e.type === "node" || e.type === "object")
            )
            .map((e: any) => e.id)
        );

        // Attempt to spawn any nodes whose timers are ready
        const spawnedCount =
          await (npcSpawns as any).spawnPersonalNodesFromRegion?.(
            shardId,
            regionId,
            roomId,
            s.id,
            ch
          );

        if (spawnedCount > 0) {
          // Diff: send entity_spawn for newly created nodes (to owner only)
          const after = entities
            .getEntitiesInRoom(roomId)
            .filter(
              (e: any) =>
                e.ownerSessionId === s.id &&
                (e.type === "node" || e.type === "object")
            );

          for (const e of after) {
            if (!before.has(e.id)) {
              sessions.send(s, "entity_spawn", e as any);
            }
          }
        }
      } catch {
        // optional log; left quiet to avoid spam
        // log.warn("personal node refresh tick failed", { err, sessionId: s.id });
      } finally {
        personalRefreshInFlight.delete(key);
      }
    }
  }, 1500);

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
    mailService,
    tradeService,
    vendorService,
    bankService,
    auctionService,
  );

  // World tick engine + SongEngine hook
  const tickEngine = new TickEngine(entities, rooms, sessions, world, {
  intervalMs: netConfig.tickIntervalMs,

  onTick: (nowMs) => {
    // Virtuoso song auto-cast tick
    for (const s of sessions.values() as Iterable<any>) {
      const ch = (s as any).character as CharacterState | undefined;
      if (!ch) continue;
      if (!s.roomId) continue; // only tick songs when actually in a room

      const ctx: MudContext = {
        sessions,
        guilds,
        session: s,
        world,
        characters,
        entities,
        items,
        rooms,
        npcs,
        trades: tradeService,
        vendors: vendorService,
        bank: bankService,
        auctions: auctionService,
        mail: mailService,
        respawns: respawnService,
      };

      tickSongsForCharacter(ctx, ch, nowMs)
        .then((result) => {
          if (!result || !result.trim()) return;

          // Send result back as a normal world chat line
          sessions.send(s, "chat", {
            from: "[world]",
            sessionId: "system",
            text: result,
            t: nowMs,
          });
        })
        .catch((err) => {
          log.warn("Song tick failed for session", {
            sessionId: s.id,
            charId: ch.id,
            err: String(err),
          });
        });
    }
  },
});

  tickEngine.start();

  // Heartbeat / idle session cleanup
  startHeartbeat(sessions, rooms, {
    intervalMs: netConfig.heartbeatIntervalMs,
    idleTimeoutMs: netConfig.idleTimeoutMs,
  });

  // HTTP + WebSocket server
  const server = http.createServer();

  const wss = new WebSocketServer({
    server,
    path: netConfig.path,
  });

  wss.on("listening", () => {
    log.success("MMO shard WebSocketServer listening", {
      host: netConfig.host,
      port: netConfig.port,
      path: netConfig.path,
    });
  });

  wss.on("connection", async (socket: WebSocket, req) => {
    const session = sessions.createSession(socket, "Anon");

    // ---- auth + character attach state ----
    let attachedIdentity: AttachedIdentity | undefined;
    let characterState: CharacterState | null = null;
    let requestedCharacterId: string | null = null;

    try {
      const base =
        req.headers.host && req.url
          ? `ws://${req.headers.host}${req.url}`
          : `ws://localhost${req.url ?? "/"}`;

      const url = new URL(base);
      const token = url.searchParams.get("token");
      requestedCharacterId = url.searchParams.get("characterId");

      if (token) {
        const payload = await auth.verifyToken(token);
        if (payload) {
          attachedIdentity = {
            userId: payload.sub,
            displayName: payload.displayName,
            flags: payload.flags,
            shardId: payload.shardId,
            characterId: payload.characterId,
          };
          session.identity = attachedIdentity;
          session.displayName = payload.displayName;

          log.info("Session authenticated", {
            sessionId: session.id,
            userId: payload.sub,
            displayName: payload.displayName,
          });
        } else if (!netConfig.authOptional) {
          log.warn("Rejecting connection: invalid token", {
            remote: req.socket.remoteAddress,
          });
          socket.close(4001, "invalid_token");
          return;
        }
      } else if (!netConfig.authOptional) {
        log.warn("Rejecting connection: missing token", {
          remote: req.socket.remoteAddress,
        });
        socket.close(4000, "missing_token");
        return;
      }

      // If we’re authenticated and have a characterId in the URL,
      // load the character from DB.
      if (attachedIdentity && requestedCharacterId) {
        try {
          const state = await characters.loadCharacter(requestedCharacterId);
          if (!state) {
            log.warn("Character not found for attach", {
              characterId: requestedCharacterId,
              userId: attachedIdentity.userId,
            });
          } else if (state.userId !== attachedIdentity.userId) {
            log.warn("Character does not belong to user", {
              characterId: requestedCharacterId,
              userId: attachedIdentity.userId,
              owner: state.userId,
            });
          } else {
            characterState = state;
            attachedIdentity.characterId = requestedCharacterId;
            session.identity = attachedIdentity;

            // Hydrate region BEFORE choosing room
            characterState = hydrateCharacterRegion(characterState, world);
            (session as any).character = characterState;

            const m = (session.character as any).melody;
            if (m) m.active = false;

            log.info("Character loaded for session", {
              sessionId: session.id,
              userId: attachedIdentity.userId,
              characterId: requestedCharacterId,
              shardId: state.shardId,
            });
          }
        } catch (err: unknown) {
          log.error("Error loading character for session", {
            err,
            sessionId: session.id,
          });
        }
      }
    } catch (err: unknown) {
      log.error("Error parsing auth token / URL", { err });
      if (!netConfig.authOptional) {
        socket.close(4002, "auth_error");
        return;
      }
    }

    if (!attachedIdentity && netConfig.authOptional) {
      log.info("Session connected without auth (dev mode)", {
        sessionId: session.id,
      });
    }

    // If we have a loaded character, attach them to the session,
    // join their shard room, and sync the entity to their position.
    if (characterState) {
      const shardId = characterState.shardId || "prime_shard";
      const regionId = characterState.lastRegionId;
      const roomId = regionId ?? shardId; // region room preferred

      // Seed NPCs BEFORE joinRoom so they are included in entity_list on join.
      // NpcSpawnController has per-room dedupe so calling this is safe.
      if (regionId) {
        try {
          const spawnedCount = await npcSpawns.spawnFromRegion(
            shardId,
            regionId,
            roomId
          );
          log.info("Auto-seeded NPCs from DB on character attach (pre-join)", {
            sessionId: session.id,
            characterId: characterState.id,
            shardId,
            roomId,
            regionId,
            spawnedCount,
          });
        } catch (err: any) {
          log.warn(
            "Failed to auto-seed NPCs from spawn_points (pre-join)",
            {
              err,
              sessionId: session.id,
              characterId: characterState.id,
              shardId,
              roomId,
              regionId,
            }
          );
        }
      }

      // ALWAYS seed personal nodes for the joining character (resources are per-player)
      // (Only if we have a regionId; personal nodes are region-scoped)
      if (regionId) {
        try {
          const spawnedNodes =
            await (npcSpawns as any).spawnPersonalNodesFromRegion?.(
              shardId,
              regionId,
              roomId,
              session.id,
              characterState
            );

          if (typeof spawnedNodes === "number") {
            log.info(
              "Seeded personal nodes on character attach (pre-join)",
              {
                sessionId: session.id,
                characterId: characterState.id,
                shardId,
                roomId,
                regionId,
                spawnedNodes,
              }
            );
          } else {
            log.warn(
              "npcSpawns.spawnPersonalNodesFromRegion missing (ore will not spawn)",
              {
                sessionId: session.id,
                characterId: characterState.id,
              }
            );
          }
        } catch (err: any) {
          log.warn("Failed to seed personal nodes on attach (pre-join)", {
            err,
            sessionId: session.id,
            characterId: characterState.id,
            shardId,
            roomId,
            regionId,
          });
        }
      }

      rooms.joinRoom(session, roomId);

      // AFTER join: push personal nodes to client so they appear immediately
      try {
        const ents = entities.getEntitiesInRoom(roomId);
        const personalNodes = ents.filter((e: any) => {
          const isNodeLike = e.type === "node" || e.type === "object";
          const hasSpawnPoint = typeof (e as any).spawnPointId === "number";
          return (
            isNodeLike &&
            hasSpawnPoint &&
            (e as any).ownerSessionId === session.id
          );
        });

        for (const e of personalNodes) {
          sessions.send(session, "entity_spawn", e as any);
        }

        if (personalNodes.length > 0) {
          log.info("Pushed personal nodes to client after join", {
            sessionId: session.id,
            roomId,
            count: personalNodes.length,
          });
        }
      } catch (err: any) {
        log.warn("Failed to push personal nodes to client after join", {
          err,
          sessionId: session.id,
          roomId,
        });
      }

      // Sync entity to character pos/name
      const ent = entities.getEntityByOwner(session.id);
      if (ent) {
        (ent as any).x = characterState.posX;
        (ent as any).y = characterState.posY;
        (ent as any).z = characterState.posZ;
        (ent as any).name = characterState.name;
      }

      log.info("Character attached to world", {
        sessionId: session.id,
        characterId: characterState.id,
        shardId,
        x: characterState.posX,
        y: characterState.posY,
        z: characterState.posZ,
        regionId: characterState.lastRegionId,
      });
    } else {
      // No character: let the client join a room later via normal messages
      log.debug("Session connected without character attach", {
        sessionId: session.id,
      });
    }

    // ---- Existing message handling ----
    socket.on("message", (data) => {
      router.handleRawMessage(session, data);
    });

    socket.on("close", () => {
      // Safety: stop any running melody on logout/disconnect
      const char = session.character;
      if (char && (char as any).melody) {
        (char as any).melody.active = false;
      }

      // Ensure we leave room so despawn broadcasts and membership doesn't leak
      rooms.leaveRoom(session);
      sessions.removeSession(session.id);
    });
  });

  server.listen(netConfig.port, netConfig.host, () => {
    log.success("MMO shard listening", {
      host: netConfig.host,
      port: netConfig.port,
      authOptional: netConfig.authOptional,
    });
  });
}

// Entry point
try {
  main();
} catch (err: unknown) {
  log.error("Fatal error in MMO server", { err });
  process.exit(1);
}
