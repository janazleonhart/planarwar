// mmo-backend/server.ts

import http from "http";
import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import "dotenv/config";

import { tickPetsForCharacter } from "../worldcore/pets/PetAi";
import { Logger } from "../worldcore/utils/logger";
import { startHeartbeat } from "../worldcore/core/Heartbeat";
import { db } from "../worldcore/db/Database";
import { PostgresAuthService } from "../worldcore/auth/PostgresAuthService";
import { AttachedIdentity } from "../worldcore/shared/AuthTypes";
import { PostgresCharacterService } from "../worldcore/characters/PostgresCharacterService";
import { CharacterState } from "../worldcore/characters/CharacterTypes";
import { hydrateCharacterRegion } from "../worldcore/characters/CharacterStateGuard";
import { netConfig } from "./config";
import { PostgresQuestService } from "../worldcore/quests/PostgresQuestService";
import { setQuestDefinitions } from "../worldcore/quests/QuestRegistry";
import { PostgresNpcService } from "../worldcore/npc/PostgresNpcService";
import { setNpcPrototypes } from "../worldcore/npc/NpcTypes";
import { installFileLogTap } from "./FileLogTap";
import type { MudContext } from "../worldcore/mud/MudContext";
import { tickSongsForCharacter, setMelodyActive, } from "../worldcore/songs/SongEngine";
import { persistCharacterSnapshot } from "../worldcore/characters/characterPersist";
import {
  createWorldServices,
  type WorldServicesOptions,
} from "../worldcore/world/WorldServices";
import { updateRegionDangerAuraForCharacter } from "../worldcore/combat/RegionDangerAuras";

installFileLogTap();

const log = Logger.scope("SERVER");

function describeSocket(ws: WebSocket): string {
  const sock: any = ws;
  const r = sock?._socket;
  if (!r) return "";
  return `${r.remoteAddress || "?"}:${r.remotePort || "?"}`;
}


type ServiceTokenRole = "readonly" | "editor" | "root";

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function parseServiceToken(token: string): { serviceId: string; role: ServiceTokenRole; sigHex: string } | null {
  const raw = String(token || "").trim();
  const m = raw.match(/^svc:([^:]+):(readonly|editor|root):([0-9a-f]+)$/i);
  if (!m) return null;
  return { serviceId: m[1], role: m[2].toLowerCase() as ServiceTokenRole, sigHex: m[3].toLowerCase() };
}

function verifyServiceToken(token: string | undefined | null): { ok: true; serviceId: string; role: ServiceTokenRole } | { ok: false; error: string } {
  const parsed = token ? parseServiceToken(token) : null;
  if (!parsed) return { ok: false, error: "missing_or_invalid_token" };

  const active = process.env.PW_SERVICE_TOKEN_SECRET || "";
  const prev = process.env.PW_SERVICE_TOKEN_SECRET_PREV || "";
  const fallback = process.env.PW_AUTH_JWT_SECRET || "";
  const secrets = [active, prev, fallback].map((s) => String(s || "")).filter(Boolean);

  if (secrets.length === 0) return { ok: false, error: "missing_secret" };

  const msg = `${parsed.serviceId}:${parsed.role}`;
  for (const secret of secrets) {
    const sig = crypto.createHmac("sha256", secret).update(msg).digest("hex");
    if (timingSafeEqualHex(sig, parsed.sigHex)) {
      return { ok: true, serviceId: parsed.serviceId, role: parsed.role };
    }
  }
  return { ok: false, error: "bad_signature" };
}

async function readJsonBody(req: http.IncomingMessage, maxBytes = 128 * 1024): Promise<any> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > maxBytes) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("bad_json"));
      }
    });

    req.on("error", (err) => reject(err));
  });
}

function writeJson(res: http.ServerResponse, status: number, obj: any): void {
  const body = JSON.stringify(obj ?? {});
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(body));
  res.end(body);
}

function getBearerOrServiceHeader(req: http.IncomingMessage): string | null {
  const auth = String(req.headers["authorization"] || "");
  const m = auth.match(/^bearer\s+(.+)$/i);
  if (m && m[1]) return m[1].trim();
  const x = req.headers["x-service-token"];
  if (typeof x === "string" && x.trim()) return x.trim();
  return null;
}

async function main() {
  log.info("Starting MMO shard server...", {
    host: netConfig.host,
    port: netConfig.port,
    path: netConfig.path,
  });

  // Auth + character services (server-owned)
  const auth = new PostgresAuthService();
  const characters = new PostgresCharacterService();

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
          "No quests found in Postgres; using hardcoded quest definitions.",
        );
      }
    })
    .catch((err) => {
      log.warn(
        "Failed to load quests from Postgres; falling back to hardcoded quest definitions.",
        { err },
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
          "No NPC prototypes found in Postgres; using hardcoded defaults.",
        );
      }
    })
    .catch((err) => {
      log.warn(
        "Failed to load NPC prototypes from Postgres; using hardcoded defaults.",
        { err },
      );
    });

  // World runtime services (composition root)
  const tickContext: {
    sessions?: any;
    guilds?: any;
    world?: any;
    characters?: any;
    entities?: any;
    items?: any;
    rooms?: any;
    npcs?: any;
    trades?: any;
    vendors?: any;
    bank?: any;
    auctions?: any;
    respawns?: any;
    mail?: any;
  } = {};

  // IMPORTANT: onTick is the only place SongEngine melody is driven.
  // Codex: do not remove or rewrite this hook unless explicitly asked.
  const worldOptions: WorldServicesOptions = {
    tickIntervalMs: netConfig.tickIntervalMs,
    onTick: (nowMs: number) => {
      const {
        sessions,
        guilds,
        world,
        characters: charSvc,
        entities,
        items,
        rooms,
        npcs,
        trades,
        vendors,
        bank,
        auctions,
        respawns,
        mail,
      } = tickContext;

      if (!sessions || !world) return;

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
          characters: charSvc,
          entities,
          items,
          rooms,
          npcs,
          trades,
          vendors,
          bank,
          auctions,
          mail,
          respawns,
        };

        updateRegionDangerAuraForCharacter(ch, nowMs);

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

        // Pet tick (v1.2): stance-driven AI-lite swings even when player is idle.
        tickPetsForCharacter(ctx, ch, nowMs)
          .then((result) => {
            if (!result || !String(result).trim()) return;
            sessions.send(s, "chat", {
              from: "[world]",
              sessionId: "system",
              text: String(result),
              t: nowMs,
            });
          })
          .catch((err) => {
            log.warn("Pet tick failed for session", {
              sessionId: s.id,
              charId: ch.id,
              err: String(err),
            });
          });
      }
    },
  };

  const services = await createWorldServices(worldOptions);
  const {
    sessions,
    entities,
    world,
    rooms,
    navGrid,
    movement,
    combat,
    terrainStream,
    objectStream,
    npcs,
    npcSpawns,
    respawns,
    items,
    guilds,
    bank,
    auctions,
    trades,
    vendors,
    mail,
    ticks,
    router,
  } = services;

  tickContext.sessions = sessions;
  tickContext.guilds = guilds;
  tickContext.world = world;
  tickContext.characters = characters;
  tickContext.entities = entities;
  tickContext.items = items;
  tickContext.rooms = rooms;
  tickContext.npcs = npcs;
  tickContext.trades = trades;
  tickContext.vendors = vendors;
  tickContext.bank = bank;
  tickContext.auctions = auctions;
  tickContext.respawns = respawns;
  tickContext.mail = mail;

  // Nav grid manager (stub for now)
  navGrid
    .init()
    .catch((err) => {
      log.warn("NavGridManager init failed", { err });
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
                (e.type === "node" || e.type === "object"),
            )
            .map((e: any) => e.id),
        );

        // Attempt to spawn any nodes whose timers are ready
        const spawnedCount = await npcSpawns.spawnPersonalNodesFromRegion(
          shardId,
          regionId,
          roomId,
          s.id,
          ch,
        );

        if (spawnedCount > 0) {
          // Diff: send entity_spawn for newly created nodes (to owner only)
          const after = entities
            .getEntitiesInRoom(roomId)
            .filter(
              (e: any) =>
                e.ownerSessionId === s.id &&
                (e.type === "node" || e.type === "object"),
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

  // World tick engine + SongEngine hook
  ticks.start();


  // Service heartbeat (ops visibility)
  // Writes a coarse snapshot into public.service_heartbeats (same table used by Mother Brain).
  // This is intentionally best-effort: failures are logged but never crash the shard.
  let serviceHbTick = 0;
  const serviceName = "mmo-backend";
  const instanceId = `planarwar:${process.pid}`;
  const hostLabel = netConfig.host || process.env.HOSTNAME || "unknown";
  const startedAtIso = new Date().toISOString();

  async function writeServiceHeartbeat(opts: { ready: boolean; wsEnabled: boolean; wsState: string }) {
    serviceHbTick++;

    const status = {
      service: serviceName,
      pid: process.pid,
      startedAt: startedAtIso,
      now: new Date().toISOString(),
      shardId: world.getWorldBlueprint().shardId ?? "unknown",
      sessions: { total: sessions.count() },
      rooms: { total: (rooms as any).getAllRooms ? (rooms as any).getAllRooms().length : undefined },
      ws: {
        enabled: opts.wsEnabled,
        state: opts.wsState,
        host: netConfig.host,
        port: netConfig.port,
        path: netConfig.path,
      },
    };

    const signature = `db:ok ws:${opts.wsEnabled ? "on" : "off"}:${opts.wsState} shard:${status.shardId}`;

    const sql = `
      INSERT INTO public.service_heartbeats (
        service_name,
        instance_id,
        host,
        pid,
        version,
        mode,
        ready,
        last_tick,
        last_signature,
        last_status_json,
        started_at,
        last_tick_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW(),NOW(),NOW())
      ON CONFLICT (service_name)
      DO UPDATE SET
        instance_id = EXCLUDED.instance_id,
        host = EXCLUDED.host,
        pid = EXCLUDED.pid,
        version = EXCLUDED.version,
        mode = EXCLUDED.mode,
        ready = EXCLUDED.ready,
        last_tick = EXCLUDED.last_tick,
        last_signature = EXCLUDED.last_signature,
        last_status_json = EXCLUDED.last_status_json,
        last_tick_at = NOW(),
        updated_at = NOW()
    `;

    try {
      await db.query(sql, [
        serviceName,
        instanceId,
        hostLabel,
        process.pid,
        process.env.npm_package_version || "0.0.0",
        "serve",
        opts.ready,
        serviceHbTick,
        signature,
        JSON.stringify(status),
      ]);
    } catch (err) {
      log.warn("Service heartbeat write failed (non-fatal)", { err });
    }
  }

  let wsState: "boot" | "listening" | "closed" = "boot";
  let wsEnabled = true;

  const hbHandle = setInterval(() => {
    void writeServiceHeartbeat({ ready: wsState === "listening", wsEnabled, wsState });
  }, Math.max(netConfig.heartbeatIntervalMs, 1000));
  hbHandle.unref?.();
  // Heartbeat / idle session cleanup
  startHeartbeat(sessions, rooms, {
    intervalMs: netConfig.heartbeatIntervalMs,
    idleTimeoutMs: netConfig.idleTimeoutMs,
  });

  // HTTP + WebSocket server
  const server = http.createServer();

server.on("request", async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname || "/";

    // Basic health for orchestration.
    if (req.method === "GET" && (pathname === "/healthz" || pathname === "/health" || pathname === "/")) {
      return writeJson(res, 200, { ok: true, service: "mmo-backend", wsPath: netConfig.path });
    }

    // Admin character management endpoints (service-token protected)
    if (pathname.startsWith("/api/admin/characters/")) {
      const token = getBearerOrServiceHeader(req);
      const v = verifyServiceToken(token);
      if (!v.ok) return writeJson(res, 401, { ok: false, error: v.error });

      if (v.role !== "editor" && v.role !== "root") {
        return writeJson(res, 403, { ok: false, error: "forbidden" });
      }

      if (req.method !== "POST") {
        return writeJson(res, 405, { ok: false, error: "method_not_allowed" });
      }

      const body = await readJsonBody(req);
      if (pathname === "/api/admin/characters/create") {
        const userId = String(body?.userId || "").trim();
        const shardId = String(body?.shardId || "prime_shard").trim();
        const name = String(body?.name || "").trim();
        const classId = String(body?.classId || "pw_class_adventurer").trim();
        if (!userId || !name) return writeJson(res, 400, { ok: false, error: "missing_fields" });

        const ch = await characters.createCharacter({ userId, shardId, name, classId } as any);
        return writeJson(res, 200, { ok: true, characterId: ch.id, name: ch.name, shardId: ch.shardId, classId: ch.classId });
      }

      if (pathname === "/api/admin/characters/rename") {
        const userId = String(body?.userId || "").trim();
        const charId = String(body?.charId || body?.characterId || "").trim();
        const name = String(body?.name || "").trim();
        if (!userId || !charId || !name) return writeJson(res, 400, { ok: false, error: "missing_fields" });

        const updated = await characters.renameCharacterForUser(userId, charId, name);
        if (!updated) return writeJson(res, 404, { ok: false, error: "not_found" });
        return writeJson(res, 200, { ok: true, characterId: updated.id, name: updated.name });
      }

      

if (pathname === "/api/admin/characters/smoke_cycle") {
  const userId = String(body?.userId || "").trim();
  const shardId = String(body?.shardId || "prime_shard").trim();
  const classId = String(body?.classId || "pw_class_adventurer").trim();
  const namePrefix = String(body?.namePrefix || "MB").trim() || "MB";
  if (!userId) return writeJson(res, 400, { ok: false, error: "missing_fields" });

  const baseName = `${namePrefix}_${Math.random().toString(36).slice(2, 8)}`;
  const ch = await characters.createCharacter({ userId, shardId, name: baseName, classId } as any);
  const renamed = await characters.renameCharacterForUser(userId, ch.id, `${baseName}_r`);
  if (!renamed) {
    // best-effort cleanup
    await characters.deleteCharacterForUser(userId, ch.id);
    return writeJson(res, 500, { ok: false, error: "rename_failed" });
  }
  const deleted = await characters.deleteCharacterForUser(userId, ch.id);
  if (!deleted) return writeJson(res, 500, { ok: false, error: "delete_failed", characterId: ch.id });

  return writeJson(res, 200, { ok: true, createdId: ch.id, renamedTo: renamed.name });
}

if (pathname === "/api/admin/characters/delete") {
        const userId = String(body?.userId || "").trim();
        const charId = String(body?.charId || body?.characterId || "").trim();
        if (!userId || !charId) return writeJson(res, 400, { ok: false, error: "missing_fields" });

        const ok = await characters.deleteCharacterForUser(userId, charId);
        return writeJson(res, 200, { ok });
      }

      return writeJson(res, 404, { ok: false, error: "not_found" });
    }

    // Default: not found.
    return writeJson(res, 404, { ok: false, error: "not_found" });
  } catch (err: any) {
    return writeJson(res, 500, { ok: false, error: String(err?.message || err || "internal_error") });
  }
});


  const wss = new WebSocketServer({
    server,
    path: netConfig.path,
  });

  wss.on("listening", () => {
    wsState = "listening";
    log.success("MMO shard WebSocketServer listening", {
      host: netConfig.host,
      port: netConfig.port,
      path: netConfig.path,
    });
  });

  wss.on("close", () => {
    wsState = "closed";
  });

  wss.on("connection", async (socket: WebSocket, req: http.IncomingMessage) => {
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
      requestedCharacterId = url.searchParams.get("characterId") ?? url.searchParams.get("charId");

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

          // If URL did not specify a character id, allow token payload to drive attach.
          if (!requestedCharacterId && attachedIdentity.characterId) {
            requestedCharacterId = attachedIdentity.characterId;
          }

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

            characterState = hydrateCharacterRegion(characterState, world);
            (session as any).character = characterState;

            // Ensure any lingering melody from a previous session is stopped
            if (session.character) {
              setMelodyActive(session.character as CharacterState, false);
            }

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
            roomId,
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
          log.warn("Failed to auto-seed NPCs from spawn_points (pre-join)", {
            err,
            sessionId: session.id,
            characterId: characterState.id,
            shardId,
            roomId,
            regionId,
          });
        }
      }

      // ALWAYS seed personal nodes for the joining character (resources are per-player)
      // (Only if we have a regionId; personal nodes are region-scoped)
      if (regionId) {
        try {
          const spawnedNodes = await npcSpawns.spawnPersonalNodesFromRegion(
            shardId,
            regionId,
            roomId,
            session.id,
            characterState,
          );

          if (typeof spawnedNodes === "number") {
            log.info("Seeded personal nodes on character attach (pre-join)", {
              sessionId: session.id,
              characterId: characterState.id,
              shardId,
              roomId,
              regionId,
              spawnedNodes,
            });
          } else {
            log.warn(
              "npcSpawns.spawnPersonalNodesFromRegion missing (ore will not spawn)",
              {
                sessionId: session.id,
                characterId: characterState.id,
              },
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



    // Send a lightweight ack so automated clients (Mother Brain, smoke tests) can detect
    // whether auth + character attach actually happened.
    // Without this, MUD commands silently no-op when session.character is missing.
    try {
      const userId = attachedIdentity?.userId ?? null;
      const authed = Boolean(attachedIdentity);
      const characterAttached = Boolean(characterState);
      const ack: any = {
        ok: true,
        authed,
        userId,
        requestedCharacterId: requestedCharacterId ?? null,
        characterAttached,
        characterId: characterState ? (characterState as any).id : null,
        shardId: characterState ? (characterState as any).shardId : null,
      };

      if (!authed) {
        ack.error = 'auth_missing_or_invalid';
      } else if (requestedCharacterId && !characterAttached) {
        ack.error = 'character_not_attached';
      }

      sessions.send(session, 'hello_ack', ack);
    } catch {
      // ignore
    }
    // ---- Existing message handling ----
    socket.on(
      "message",
      (data: string | Buffer | ArrayBuffer | Buffer[]) => {
        router.handleRawMessage(session, data);
      }
    );

    socket.on("close", () => {
      // WS close event is sync; we run async persistence best-effort.
      void (async () => {
        const char = session.character as CharacterState | undefined;

        // Safety: stop any running melody on logout/disconnect
        if (char) {
          setMelodyActive(char, false);
        }

        // Best-effort: persist character snapshot (includes progression.flags.pet)
        // BEFORE we leave the room so lastRegionId/pos are correct.
        if (char) {
          try {
            // Sync from live entity + session room if available.
            const ent = entities.getEntityByOwner(session.id);
            if (ent) {
              (char as any).posX = (ent as any).x ?? char.posX;
              (char as any).posY = (ent as any).y ?? char.posY;
              (char as any).posZ = (ent as any).z ?? char.posZ;
            }
            if (session.roomId) {
              (char as any).lastRegionId = session.roomId;
            }

            const ctx: MudContext = {
              sessions,
              guilds,
              session,
              world,
              characters,
              entities,
              items,
              rooms,
              npcs,
              trades,
              vendors,
              bank,
              auctions,
              mail,
              respawns,
            } as any;

            await persistCharacterSnapshot(ctx, char);
          } catch (err: any) {
            // Dev mode sessions may have no identity/userId. Never crash close.
            log.debug("persistCharacterSnapshot skipped/failed on disconnect", {
              sessionId: session.id,
              charId: (char as any)?.id,
              err: String(err?.message ?? err),
            });
          }
        }

        // Ensure we leave room so despawn broadcasts and membership doesn't leak
        rooms.leaveRoom(session);
        sessions.removeSession(session.id);
      })();
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
main().catch((err: unknown) => {
  log.error("Fatal error in MMO server", { err });
  process.exit(1);
});