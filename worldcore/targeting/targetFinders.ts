// worldcore/targeting/targetFinders.ts
//
// Legacy targeting helpers that pre-date TargetResolver.
// These are still used by a few combat/spell paths, but should trend toward:
// - build candidates (players/NPCs) from the current context, then
// - delegate selection to TargetResolver so tokens behave consistently.
//
// Player targeting in particular must NOT assume session.roomId exists.
// Many tests (and some lightweight providers) omit it; entity.roomId is the
// authoritative source of truth.

import type { Entity } from "../shared/Entity";
import { resolveTargetInRoom } from "./TargetResolver";

export type TargetingContext = {
  session: { id: string };
  sessions: {
    getAllSessions(): Iterable<{
      id: string;
      roomId?: string | null; // optional: tests often omit it
      character?: { name: string } | null;
    }>;
  };
  entities?: {
    getAll?: () => Iterable<Entity> | Entity[];
    getEntityByOwner(ownerId: string): Entity | null | undefined;
  };
};

function normalizeName(s: any): string {
  return String(s ?? "").trim().toLowerCase();
}

function isPlayerLikeEntity(ent: any): boolean {
  if (!ent) return false;
  const t = String(ent.type ?? "").toLowerCase();
  const hasSpawnPoint = typeof ent.spawnPointId === "number";
  return t === "player" || (!!ent.ownerSessionId && !hasSpawnPoint);
}

export function findTargetPlayerEntityByName(
  ctx: TargetingContext,
  meRoomId: string,
  targetTokenRaw: string
): { entity: Entity; name: string } | null {
  const token = String(targetTokenRaw ?? "").trim();
  if (!token) return null;

  const entities = ctx.entities;
  if (!entities || typeof entities.getEntityByOwner !== "function") return null;

  const selfSessionId = String(ctx.session?.id ?? "");
  const selfEnt = entities.getEntityByOwner(selfSessionId) ?? null;

  // Explicit self tokens: we do not return self as a "target other player" result.
  const low = token.toLowerCase();
  if (low === "me" || low === "self" || low === "myself") return null;

  const rows: Array<{ sid: string; name: string; ent: Entity }> = [];

  for (const s of ctx.sessions.getAllSessions()) {
    if (!s || !s.id) continue;
    const sid = String(s.id);
    if (sid === selfSessionId) continue;

    const ent = entities.getEntityByOwner(sid);
    if (!ent) continue;

    const inRoom =
      String((ent as any).roomId ?? "") === String(meRoomId ?? "") ||
      String((s as any).roomId ?? "") === String(meRoomId ?? "");
    if (!inRoom) continue;

    if (!isPlayerLikeEntity(ent)) continue;

    const name = String((s as any)?.character?.name ?? (ent as any)?.name ?? "").trim();
    rows.push({ sid, name, ent });
  }

  if (!rows.length) return null;

  // Prefer TargetResolver semantics: entity id / nearby index / handle / base.
  // We pass only player entities, so no extra filter is needed.
  const originX = Number((selfEnt as any)?.x ?? (selfEnt as any)?.posX ?? 0);
  const originZ = Number((selfEnt as any)?.z ?? (selfEnt as any)?.posZ ?? 0);

  const candidates = rows.map((r) => r.ent);

  const picked = resolveTargetInRoom(candidates as any, String(meRoomId ?? ""), token, {
    selfId: selfEnt ? String((selfEnt as any).id ?? "") : undefined,
    viewerSessionId: selfSessionId,
    radius: 30,
    originX,
    originZ,
  });

  if (picked) {
    const hit = rows.find((r) => String((r.ent as any).id ?? "") === String((picked as any).id ?? ""));
    return { entity: picked, name: hit?.name || String((picked as any).name ?? token) };
  }

  // Legacy fallback: try to match by character name (case-insensitive) when user types plain text.
  const needle = normalizeName(token);

  const exact = rows.filter((r) => normalizeName(r.name) === needle);
  if (exact.length === 1) return { entity: exact[0].ent, name: exact[0].name };

  const prefix = rows.filter((r) => normalizeName(r.name).startsWith(needle));
  if (prefix.length === 1) return { entity: prefix[0].ent, name: prefix[0].name };

  const includes = rows.filter((r) => normalizeName(r.name).includes(needle));
  if (includes.length === 1) return { entity: includes[0].ent, name: includes[0].name };

  return null;
}



type NpcTargetResolveContext = {
  session?: { id: string };
  entities?: {
    getAll?: () => Iterable<Entity> | Entity[];
    getEntitiesInRoom?: (roomId: string) => Iterable<Entity> | Entity[];
    getEntityByOwner?: (ownerId: string) => Entity | null | undefined;
    getEntity?: (id: string) => Entity | null | undefined;
  };
};

function getRoomEntities(entities: any, roomId: string): Entity[] {
  if (!entities) return [];
  try {
    if (typeof entities.getEntitiesInRoom === "function") {
      return toArray(entities.getEntitiesInRoom(String(roomId ?? "")) as any);
    }
  } catch {
    // ignore
  }
  try {
    if (typeof entities.getAll === "function") {
      return toArray<Entity>(entities.getAll() as Iterable<Entity> | Entity[]).filter(
        (ent) => String((ent as any)?.roomId ?? "") === String(roomId ?? "")
      );
    }
  } catch {
    // ignore
  }
  return [];
}

function isNpcLikeEntity(ent: any): boolean {
  const t = String(ent?.type ?? "").toLowerCase();
  return t === "npc" || t === "mob";
}

function tokenLooksNearbyHandleLike(raw: string): boolean {
  const token = String(raw ?? "").trim().toLowerCase();
  if (!token) return false;
  return /^\d+$/.test(token) || /^[a-z0-9_]+(?:[.#]\d+)?$/i.test(token);
}

function normalizeNearbyHandleBase(raw: string): string {
  return normalizeName(String(raw ?? "").replace(/#/g, ".").replace(/\.\d+$/, ""));
}

function isTrainingDummyLikeEntity(ent: any): boolean {
  if (!ent || !isNpcLikeEntity(ent)) return false;
  const protoId = normalizeName(String(ent?.protoId ?? ent?.templateId ?? ""));
  const name = normalizeName(String(ent?.name ?? ""));
  return (
    protoId === "training_dummy" ||
    protoId === "training_dummy_big" ||
    name.includes("training dummy")
  );
}

function tokenLooksTrainingDummyLike(raw: string): boolean {
  const base = normalizeNearbyHandleBase(raw);
  if (!base) return false;
  return base === "dummy" || base === "training_dummy" || base === "training dummy" || base.includes("dummy");
}

export function resolveNpcTargetEntityInRoom(
  ctx: NpcTargetResolveContext,
  roomId: string,
  targetTokenRaw: string,
  selfEntity?: Entity | null
): Entity | null {
  const token = String(targetTokenRaw ?? "").trim();
  if (!token) return null;

  const entities = ctx.entities;
  if (!entities) return null;

  const selfSessionId = String(ctx.session?.id ?? "");
  const selfEnt =
    selfEntity ??
    (typeof entities.getEntityByOwner === "function" && selfSessionId
      ? entities.getEntityByOwner(selfSessionId) ?? null
      : null);

  const roomEntities = getRoomEntities(entities, roomId);
  const candidates = roomEntities.filter((ent: any) => isNpcLikeEntity(ent));
  if (!candidates.length) return null;

  const originX = Number((selfEnt as any)?.x ?? (selfEnt as any)?.posX ?? 0);
  const originZ = Number((selfEnt as any)?.z ?? (selfEnt as any)?.posZ ?? 0);

  const picked = resolveTargetInRoom(candidates as any, String(roomId ?? ""), token, {
    selfId: selfEnt ? String((selfEnt as any).id ?? "") : undefined,
    viewerSessionId: selfSessionId,
    radius: 30,
    originX,
    originZ,
  });
  if (picked) return picked;

  // Defensive parity fallback:
  // if the player just engaged a nearby NPC via attack/ability, let spell casts reuse
  // that target when the typed token is a nearby-style handle/base/index for it.
  const engagedId = String((selfEnt as any)?.engagedTargetId ?? "").trim();
  const engaged = engagedId
    ? roomEntities.find((ent: any) => String((ent as any)?.id ?? "") === engagedId) ?? null
    : null;
  if (engaged && isNpcLikeEntity(engaged) && tokenLooksNearbyHandleLike(token)) {
    const engagedPicked = resolveTargetInRoom([engaged] as any, String(roomId ?? ""), token, {
      viewerSessionId: selfSessionId,
      radius: 30,
      originX,
      originZ,
    });
    if (engagedPicked) return engagedPicked;

    const engagedName = normalizeName(String((engaged as any)?.name ?? ""));
    const tokenNorm = normalizeNearbyHandleBase(token);
    if (engagedName && tokenNorm && engagedName.includes(tokenNorm)) {
      return engaged;
    }
  }

  // Training-dummy alias parity:
  // attack accepts loose dummy tokens via the room-local dummy service fallback,
  // so spells/abilities should treat dummy / dummy.1 similarly when a live
  // training dummy NPC is present in the room.
  if (tokenLooksTrainingDummyLike(token)) {
    const dummyByNameOrProto = candidates.find((ent: any) => {
      if (!isTrainingDummyLikeEntity(ent)) return false;
      const protoId = normalizeName(String(ent?.protoId ?? ent?.templateId ?? ""));
      const name = normalizeName(String(ent?.name ?? ""));
      return (
        protoId === "training_dummy_big" ||
        protoId === "training_dummy" ||
        name.includes("training dummy")
      );
    });
    if (dummyByNameOrProto) return dummyByNameOrProto;
  }

  return null;
}
export function findNearestNpcByName(
  ctx: TargetingContext,
  roomId: string,
  targetNameRaw: string
): { entity: Entity; name: string } | null {
  const entities = ctx.entities;
  if (!entities || typeof entities.getAll !== "function") return null;

  const name = targetNameRaw.toLowerCase().trim();
  if (!name) return null;

  const all: Entity[] = Array.from(
    entities.getAll() as Iterable<Entity>
  ).filter((ent) => (ent as any).type === "npc" && String((ent as any).roomId ?? "") === String(roomId) && !!(ent as any).name);

  for (const ent of all as any) {
    if ((ent as any).type !== "npc") continue;
    if (String((ent as any).roomId ?? "") !== String(roomId)) continue;
    if (!(ent as any).name) continue;

    const entName = String((ent as any).name).toLowerCase();
    if (entName === name || entName.includes(name)) {
      return { entity: ent, name: (ent as any).name };
    }
  }

  return null;
}

function toArray<T>(x: Iterable<T> | T[]): T[] {
  return Array.isArray(x) ? x : Array.from(x);
}

function normalize(s: string) {
  return s.toLowerCase().trim();
}

type EntitySource =
  | { getAll?: () => Iterable<Entity> | Entity[]; getEntitiesInRoom?: (roomId: string) => Iterable<Entity> | Entity[] }
  | { entities?: { getAll?: () => Iterable<Entity> | Entity[]; getEntitiesInRoom?: (roomId: string) => Iterable<Entity> | Entity[] } };

function getEntityManager(
  source: any
): { getAll?: () => Iterable<Entity> | Entity[]; getEntitiesInRoom?: (roomId: string) => Iterable<Entity> | Entity[] } | null {
  if (!source) return null;
  if (typeof source.getAll === "function" || typeof source.getEntitiesInRoom === "function") return source;
  const nested = (source as any).entities;
  if (nested && (typeof nested.getAll === "function" || typeof nested.getEntitiesInRoom === "function")) return nested;
  return null;
}

export function findNpcTargetByName(
  source: EntitySource | any,
  roomId: string,
  targetNameRaw: string
): Entity | null {
  const raw = targetNameRaw.trim();
  if (!raw) return null;

  const entities = getEntityManager(source);
  if (!entities) return null;

  const roomCandidates: Entity[] = (() => {
    if (typeof entities.getEntitiesInRoom === "function") {
      return toArray(entities.getEntitiesInRoom(String(roomId)) as any);
    }
    if (typeof entities.getAll === "function") {
      return toArray(entities.getAll() as any);
    }
    return [];
  })();

  const all: Entity[] = roomCandidates.filter(
    (ent) => (ent as any).type === "npc" && String((ent as any).roomId ?? "") === String(roomId) && !!(ent as any).name
  );

  // stable ordering
  all.sort((a: any, b: any) => String((a as any).name).localeCompare(String((b as any).name)) || String((a as any).id).localeCompare(String((b as any).id)));

  // Case 1: "2" => 2nd NPC in room
  if (/^\d+$/.test(raw)) {
    const idx = Math.max(1, parseInt(raw, 10)) - 1;
    return all[idx] ?? null;
  }

  // Case 2: "guard.2" or "guard#2"
  const m = raw.match(/^(.+?)[.#](\d+)$/);
  if (m) {
    const namePart = normalize(m[1]);
    const want = Math.max(1, parseInt(m[2], 10)) - 1;

    const matches = all.filter((e: any) => normalize(String((e as any).name)).includes(namePart));
    return matches[want] ?? null;
  }

  // Case 3: normal name search
  const name = normalize(raw);
  return all.find((e: any) => {
    const n = normalize(String((e as any).name));
    return n === name || n.includes(name);
  }) ?? null;
}
