// worldcore/targeting/targetFinders.ts

import type { Entity } from "../shared/Entity";

export type TargetingContext = {
  session: { id: string };
  sessions: {
    getAllSessions(): Iterable<{
      id: string;
      roomId?: string | null; // allow undefined too
      character?: { name: string } | null;
    }>;
  };
  entities?: {
    getAll(): Iterable<Entity> | Entity[];
    getEntityByOwner(ownerId: string): Entity | null | undefined;
  };
};

export function findTargetPlayerEntityByName(
  ctx: TargetingContext,
  meRoomId: string,
  targetNameRaw: string
): { entity: Entity; name: string } | null {
  const targetName = targetNameRaw.toLowerCase().trim();
  if (!targetName) return null;

  const entities = ctx.entities;
  if (!entities) return null;

  const sessions = ctx.sessions.getAllSessions();
  let targetSessionId: string | null = null;
  let displayName = "";

  for (const s of sessions) {
    if (s.id === ctx.session.id) continue;
    if (s.roomId !== meRoomId) continue;

    const c = s.character;
    if (!c) continue;

    if (c.name.toLowerCase() === targetName) {
      targetSessionId = s.id;
      displayName = c.name;
      break;
    }
  }

  if (!targetSessionId) return null;

  const ent = entities.getEntityByOwner(targetSessionId);
  if (!ent) return null;

  return { entity: ent, name: displayName || ent.name };
}

export function findNearestNpcByName(
  ctx: TargetingContext,
  roomId: string,
  targetNameRaw: string
): { entity: Entity; name: string } | null {
  const entities = ctx.entities;
  if (!entities) return null;

  const name = targetNameRaw.toLowerCase().trim();
  if (!name) return null;

  const all: Entity[] = Array.from(
    entities.getAll() as Iterable<Entity>
  ).filter((ent) => ent.type === "npc" && ent.roomId === roomId && !!ent.name);

  for (const ent of all as any) {
    if (ent.type !== "npc") continue;
    if (ent.roomId !== roomId) continue;
    if (!ent.name) continue;

    const entName = ent.name.toLowerCase();
    if (entName === name || entName.includes(name)) {
      return { entity: ent, name: ent.name };
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

export function findNpcTargetByName(
  entities: { getAll(): Iterable<Entity> | Entity[] },
  roomId: string,
  targetNameRaw: string
): Entity | null {
  const raw = targetNameRaw.trim();
  if (!raw) return null;

  const all: Entity[] = toArray(entities.getAll())
    .filter((ent) => ent.type === "npc" && ent.roomId === roomId && !!ent.name);

  // stable ordering
  all.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

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

    const matches = all.filter((e) => normalize(e.name).includes(namePart));
    return matches[want] ?? null;
  }

  // Case 3: normal name search
  const name = normalize(raw);
  return all.find((e) => {
    const n = normalize(e.name);
    return n === name || n.includes(name);
  }) ?? null;
}
