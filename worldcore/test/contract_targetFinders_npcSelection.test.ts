// worldcore/test/contract_targetFinders_npcSelection.test.ts
//
// Contract tests for targetFinders.findNpcTargetByName.
// Locks down sorting + numbered syntax behavior used by MudSpells.

import assert from "node:assert/strict";
import test from "node:test";

import { findNpcTargetByName } from "../targeting/targetFinders";

type E = {
  id: string;
  type: "npc" | "player" | "node" | "object";
  name?: string;
  roomId: string;
};

test("[contract] targetFinders NPC finder supports index-only selection ('2')", () => {
  const entities = {
    getAll: () =>
      [
        { id: "npc_2", type: "npc", name: "Town Rat", roomId: "r1" },
        { id: "npc_1", type: "npc", name: "Town Rat", roomId: "r1" },
        { id: "npc_3", type: "npc", name: "Iron Vein", roomId: "r1" }, // not npc? but still npc here; name sort matters
      ] as any as E[],
  };

  const pick2 = findNpcTargetByName(entities as any, "r1", "2");
  // Sorting: name then id => Iron Vein first, then Town Rat npc_1, then Town Rat npc_2
  assert.equal(pick2?.id, "npc_1");
});

test("[contract] targetFinders NPC finder supports numbered syntax ('rat.2' / 'rat#2')", () => {
  const entities = {
    getAll: () =>
      [
        { id: "npc_a", type: "npc", name: "Town Rat", roomId: "r1" },
        { id: "npc_b", type: "npc", name: "Town Rat", roomId: "r1" },
        { id: "npc_c", type: "npc", name: "Town Guard", roomId: "r1" },
      ] as any as E[],
  };

  const rat2 = findNpcTargetByName(entities as any, "r1", "rat.2");
  assert.equal(rat2?.id, "npc_b");

  const rat1hash = findNpcTargetByName(entities as any, "r1", "rat#1");
  assert.equal(rat1hash?.id, "npc_a");
});

test("[contract] targetFinders NPC finder supports partial match", () => {
  const entities = {
    getAll: () =>
      [
        { id: "npc_a", type: "npc", name: "Town Rat", roomId: "r1" },
        { id: "npc_c", type: "npc", name: "Town Guard", roomId: "r1" },
      ] as any as E[],
  };

  const rat = findNpcTargetByName(entities as any, "r1", "rat");
  assert.equal(rat?.id, "npc_a");
});
