import type { Entity } from "./Entity";

export type SessionLike = {
  id: string;
  roomId?: string | null;
  character?: { name: string } | null;
};

export type SessionsManagerLike = {
  getAllSessions(): Iterable<SessionLike>;
};

export type EntitiesManagerLike = {
  getAll(): Iterable<Entity> | Entity[];
  getEntityByOwner(ownerId: string): Entity | null | undefined;
};
