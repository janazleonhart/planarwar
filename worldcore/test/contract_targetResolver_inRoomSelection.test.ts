// worldcore/test/contract_targetResolver_inRoomSelection.test.ts
//
// Contract tests for TargetResolver.resolveTargetInRoom.
// Locks down name normalization, numbered selection, filter behavior, and self-exclusion.

import assert from "node:assert/strict";
import test from "node:test";

import { resolveTargetInRoom } from "../targeting/TargetResolver";

type E = {
  id: string;
  type: "npc" | "player" | "node" | "object";
  name?: string;
  roomId: string;
};

test("[contract] TargetResolver supports index-only selection ('2') with stable ordering", () => {
  const provider = {
    getEntitiesInRoom: (_roomId: string) =>
      [
        { id: "npc_2", type: "npc", name: "Town Rat", roomId: "r1" },
        { id: "npc_1", type: "npc", name: "Town Rat", roomId: "r1" },
        { id: "npc_3", type: "npc", name: "Iron Vein", roomId: "r1" },
      ] as any as E[],
  };

  const pick2 = resolveTargetInRoom(provider as any, "r1", "2", {
    filter: (e: any) => e.type === "npc",
  });

  // Ordering: normalized name then id, so "Iron Vein" sorts before "Town Rat"
  // candidates => [Iron Vein (npc_3), Town Rat (npc_1), Town Rat (npc_2)]
  assert.equal(pick2?.id, "npc_1");
});

test("[contract] TargetResolver supports numbered syntax ('rat.2' / 'rat#2')", () => {
  const provider = {
    getEntitiesInRoom: (_roomId: string) =>
      [
        { id: "npc_a", type: "npc", name: "Town Rat", roomId: "r1" },
        { id: "npc_b", type: "npc", name: "Town Rat", roomId: "r1" },
        { id: "npc_c", type: "npc", name: "Town Guard", roomId: "r1" },
      ] as any as E[],
  };

  const rat2 = resolveTargetInRoom(provider as any, "r1", "rat.2", {
    filter: (e: any) => e.type === "npc",
  });

  assert.equal(rat2?.id, "npc_b");

  const rat1hash = resolveTargetInRoom(provider as any, "r1", "rat#1", {
    filter: (e: any) => e.type === "npc",
  });

  assert.equal(rat1hash?.id, "npc_a");
});

test("[contract] TargetResolver excludes selfId and respects filter predicate", () => {
  const provider = {
    getEntitiesInRoom: (_roomId: string) =>
      [
        { id: "me", type: "player", name: "Me", roomId: "r1" },
        { id: "npc_1", type: "npc", name: "Town Rat", roomId: "r1" },
        { id: "node_1", type: "node", name: "Iron Vein", roomId: "r1" },
      ] as any as E[],
  };

  const pickRat = resolveTargetInRoom(provider as any, "r1", "rat", {
    selfId: "me",
    filter: (e: any) => e.type === "npc",
  });

  assert.equal(pickRat?.id, "npc_1");

  const pickVeinAsNpc = resolveTargetInRoom(provider as any, "r1", "vein", {
    selfId: "me",
    filter: (e: any) => e.type === "npc",
  });

  assert.equal(pickVeinAsNpc, null, "Filter should be authoritative");
});
