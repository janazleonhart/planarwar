// worldcore/test/contract_targetFinders_playerSelection.test.ts
//
// Contract tests for targetFinders.findTargetPlayerEntityByName.
// Locks down session-name mapping + same-room constraint.

import assert from "node:assert/strict";
import test from "node:test";

import { findTargetPlayerEntityByName } from "../targeting/targetFinders";

type E = {
  id: string;
  type: "player" | "npc" | "node" | "object";
  name?: string;
  roomId: string;
};

test("[contract] targetFinders player finder resolves by session character name (case-insensitive) in same room", () => {
  const ents: Record<string, E> = {
    sess_me: { id: "ent_me", type: "player", name: "Me", roomId: "r1" },
    sess_a: { id: "ent_a", type: "player", name: "Alice", roomId: "r1" },
    sess_b: { id: "ent_b", type: "player", name: "Bob", roomId: "r2" },
  };

  const ctx: any = {
    session: { id: "sess_me" },
    sessions: {
      getAllSessions: () => [
        { id: "sess_me", roomId: "r1", character: { name: "Me" } },
        { id: "sess_a", roomId: "r1", character: { name: "Alice" } },
        { id: "sess_b", roomId: "r2", character: { name: "Bob" } },
      ],
    },
    entities: {
      getAll: () => Object.values(ents),
      getEntityByOwner: (ownerId: string) => ents[ownerId] ?? null,
    },
  };

  const found = findTargetPlayerEntityByName(ctx, "r1", "ALICE");
  assert.ok(found);
  assert.equal(found?.entity.id, "ent_a");
  assert.equal(found?.name, "Alice");
});

test("[contract] targetFinders player finder does not return players in other rooms", () => {
  const ents: Record<string, E> = {
    sess_me: { id: "ent_me", type: "player", name: "Me", roomId: "r1" },
    sess_b: { id: "ent_b", type: "player", name: "Bob", roomId: "r2" },
  };

  const ctx: any = {
    session: { id: "sess_me" },
    sessions: {
      getAllSessions: () => [
        { id: "sess_me", roomId: "r1", character: { name: "Me" } },
        { id: "sess_b", roomId: "r2", character: { name: "Bob" } },
      ],
    },
    entities: {
      getAll: () => Object.values(ents),
      getEntityByOwner: (ownerId: string) => ents[ownerId] ?? null,
    },
  };

  const found = findTargetPlayerEntityByName(ctx, "r1", "bob");
  assert.equal(found, null);
});
