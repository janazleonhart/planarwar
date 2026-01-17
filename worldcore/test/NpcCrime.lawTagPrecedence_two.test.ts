// worldcore/test/NpcCrime.lawTagPrecedence.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { isProtectedNpc } from "../npc/NpcCrime";
import type { NpcPrototype } from "../npc/NpcTypes";

function protoWithTags(tags: string[]): NpcPrototype {
  return {
    id: "test_proto",
    name: "Test Proto",
    level: 1,
    maxHp: 10,
    baseDamageMin: 0,
    baseDamageMax: 0,
    tags,
    behavior: "neutral",
    xpReward: 0,
    loot: [],
  };
}

test("law_exempt overrides law_protected and legacy protection tags", () => {
  const p = protoWithTags(["law_protected", "protected_town", "vendor", "law_exempt"]);
  assert.equal(isProtectedNpc(p), false);
});

test("law_protected forces protection even without legacy tags", () => {
  const p = protoWithTags(["law_protected"]);
  assert.equal(isProtectedNpc(p), true);
});

test("legacy protection tags still imply protection when no law_* tags exist", () => {
  const p = protoWithTags(["protected_town"]);
  assert.equal(isProtectedNpc(p), true);
});

test("guards are never protected for crime purposes (even with law_protected)", () => {
  const p = protoWithTags(["guard", "law_protected", "protected_town"]);
  assert.equal(isProtectedNpc(p), false);
});

test("resource nodes are never protected for crime purposes (even with law_protected)", () => {
  const p = protoWithTags(["resource", "law_protected", "protected_town"]);
  assert.equal(isProtectedNpc(p), false);
});
