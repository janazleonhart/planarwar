// worldcore/test/contract_townQuestGenerator_rotation_fairness.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { generateTownQuests } from "../quests/QuestGenerator";

function isImmune(id: string): boolean {
  return id.endsWith("greet_quartermaster") || id.endsWith("rat_culling");
}

test("[contract] town quest generator v0.15: recently-offered ids are deprioritized (soft)", () => {
  const townId = "prime_shard:0,0";
  const tier = 4;
  const epoch = "2026-W03";

  const first = generateTownQuests({ townId, tier, epoch, maxQuests: 6, includeRepeatables: true });

  const firstNonImmune = first.map((q) => q.id).filter((id) => !isImmune(id));

  const rotated = generateTownQuests({
    townId,
    tier,
    epoch,
    maxQuests: 6,
    includeRepeatables: true,
    recentlyOfferedQuestIds: firstNonImmune,
  });

  // Immune onboarding quests remain present.
  assert.ok(rotated.some((q) => q.id.endsWith("greet_quartermaster")));
  assert.ok(rotated.some((q) => q.id.endsWith("rat_culling")));

  const rotatedNonImmune = rotated.map((q) => q.id).filter((id) => !isImmune(id));

  // Soft guarantee: if the pool is large enough, at least one non-immune id changes.
  // (If the pool is tiny, the generator is allowed to repeat rather than underfill.)
  const overlap = rotatedNonImmune.filter((id) => firstNonImmune.includes(id));
  assert.ok(
    overlap.length < rotatedNonImmune.length,
    `Expected rotation to introduce at least one new quest id (overlap=${overlap.length}, total=${rotatedNonImmune.length})`
  );
});

test("[contract] town quest generator v0.15: rotation inputs remain deterministic", () => {
  const townId = "prime_shard:0,0";
  const tier = 4;
  const epoch = "2026-W03";

  const recent = [
    "town_prime_shard_0_0_t4_resource_sampling_ore",
    "town_prime_shard_0_0_t4_pest_control_supplies",
  ];

  const a = generateTownQuests({ townId, tier, epoch, maxQuests: 6, recentlyOfferedQuestIds: recent });
  const b = generateTownQuests({ townId, tier, epoch, maxQuests: 6, recentlyOfferedQuestIds: recent });

  assert.deepStrictEqual(a, b);
});
