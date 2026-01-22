import test from "node:test";
import assert from "node:assert/strict";

import { resolveTargetInRoom } from "../targeting/TargetResolver";

type E = any;

function makeProvider(entities: E[]) {
  return {
    getEntitiesInRoom(roomId: string) {
      return entities.filter((e) => e.roomId === roomId);
    },
  };
}

test("[contract] target resolver uses nearby-style index + handle ordering", () => {
  const roomId = "room.test";

  const self: E = {
    id: "player.rimuru.1",
    type: "player",
    name: "Rimuru",
    roomId,
    ownerSessionId: "sess.rimuru",
    x: 0,
    z: 0,
  };

  const ratNear: E = {
    id: "npc.rat.near",
    type: "npc",
    name: "Rat",
    roomId,
    x: 1,
    z: 0,
  };

  const ratFar: E = {
    id: "npc.rat.far",
    type: "npc",
    name: "Rat",
    roomId,
    x: 5,
    z: 0,
  };

  const guard: E = {
    id: "npc.guard.1",
    type: "npc",
    name: "Town Guard",
    roomId,
    x: 2,
    z: 0,
  };

  const provider = makeProvider([self, ratFar, guard, ratNear]);

  const filterNpc = (e: any) => e?.type === "npc" || e?.type === "mob";

  // 1) Nearby-style numeric index should follow nearby ordering (distance first).
  const t1 = resolveTargetInRoom(provider as any, roomId, "1", {
    selfId: self.id,
    filter: filterNpc,
    radius: 30,
  });
  assert.equal(t1?.id, ratNear.id);

  // 2) Handle should match nearby handles (rat.1 should be the nearest rat).
  const h1 = resolveTargetInRoom(provider as any, roomId, "rat.1", {
    selfId: self.id,
    filter: filterNpc,
    radius: 30,
  });
  assert.equal(h1?.id, ratNear.id);

  const h2 = resolveTargetInRoom(provider as any, roomId, "rat.2", {
    selfId: self.id,
    filter: filterNpc,
    radius: 30,
  });
  assert.equal(h2?.id, ratFar.id);

  // 3) Base token chooses the first matching base in nearby ordering.
  const b1 = resolveTargetInRoom(provider as any, roomId, "rat", {
    selfId: self.id,
    filter: filterNpc,
    radius: 30,
  });
  assert.equal(b1?.id, ratNear.id);

  // 4) Exact entity id match wins.
  const idPick = resolveTargetInRoom(provider as any, roomId, ratFar.id, {
    selfId: self.id,
    filter: filterNpc,
    radius: 30,
  });
  assert.equal(idPick?.id, ratFar.id);

  // 5) Fuzzy match prefers nearby ordering when multiple matches exist.
  const fuzzy = resolveTargetInRoom(provider as any, roomId, "guard", {
    selfId: self.id,
    filter: filterNpc,
    radius: 30,
  });
  assert.equal(fuzzy?.id, guard.id);
});
