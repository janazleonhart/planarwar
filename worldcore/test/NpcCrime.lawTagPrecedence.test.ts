import test from "node:test";
import assert from "node:assert/strict";

import { isProtectedNpc } from "../npc/NpcCrime";
import type { NpcPrototype } from "../npc/NpcTypes";

function makeProto(tags: string[]): NpcPrototype {
  return {
    id: "test_npc",
    name: "Test NPC",
    level: 1,
    maxHp: 10,
    baseDamageMin: 0,
    baseDamageMax: 0,
    model: "",
    tags,
    behavior: "neutral",
    xpReward: 0,
    loot: [],
  };
}

test("[contract] law tag precedence over legacy protection tags", () => {
  // 'law_exempt' should override *any* protection implied by other tags.
  assert.equal(isProtectedNpc(makeProto(["protected_town", "law_exempt"])), false);
  assert.equal(isProtectedNpc(makeProto(["civilian", "law_exempt"])), false);

  // 'law_protected' should mark the NPC protected even if it otherwise wouldn't be.
  assert.equal(isProtectedNpc(makeProto(["law_protected"])), true);

  // If both are present, 'law_exempt' wins (quest/corruption overrides are safer).
  assert.equal(
    isProtectedNpc(makeProto(["law_protected", "law_exempt", "protected_town"])),
    false
  );

  // Hard overrides that should remain hard overrides.
  assert.equal(isProtectedNpc(makeProto(["resource", "law_protected"])), false);
  assert.equal(isProtectedNpc(makeProto(["guard", "law_protected"])), false);
});
