import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNearbyTargetSnapshot,
  makeShortHandleBase,
  parseHandleToken,
  resolveNearbyHandleInRoom,
} from "../mud/handles/NearbyHandles";

test("[contract] nearby handles: base token + parse + collision resolution prefers alive", () => {
  assert.equal(makeShortHandleBase("Shard Alchemist"), "alchemist");
  assert.deepEqual(parseHandleToken("rat.2"), { base: "rat", idx: 2 });
  assert.deepEqual(parseHandleToken("guard"), { base: "guard" });
  assert.equal(parseHandleToken(""), null);
  assert.equal(parseHandleToken("..1"), null);

  const entities = [
    { id: "npc_alive", type: "npc", name: "Town Rat", x: 1, z: 0, alive: true },
    { id: "npc_dead", type: "npc", name: "Town Rat", x: 2, z: 0, alive: false },

    // Foreign personal node: should be invisible to handle snapshot
    { id: "node_other", type: "node", name: "Copper Vein", x: 1, z: 1, spawnPointId: 5, ownerSessionId: "other" },

    // Shared node: visible
    { id: "node_shared", type: "node", name: "Copper Vein", x: 1, z: 2, spawnPointId: 6, ownerSessionId: null },
  ];

  const snap = buildNearbyTargetSnapshot({
    entities,
    viewerSessionId: "viewer",
    originX: 0,
    originZ: 0,
    radius: 30,
  });

  // We should see alive rat + corpse rat + shared node, but NOT the foreign personal node.
  const ids = snap.map((s) => s.e.id);
  assert.ok(ids.includes("npc_alive"));
  assert.ok(ids.includes("npc_dead"));
  assert.ok(ids.includes("node_shared"));
  assert.ok(!ids.includes("node_other"));

  // Both alive+corpse can legitimately share the same handle. Resolver must prefer the first (alive).
  const hit = resolveNearbyHandleInRoom({
    entities,
    viewerSessionId: "viewer",
    originX: 0,
    originZ: 0,
    radius: 30,
    handleRaw: "rat.1",
  });

  assert.ok(hit);
  assert.equal(hit!.entity.id, "npc_alive");
});
