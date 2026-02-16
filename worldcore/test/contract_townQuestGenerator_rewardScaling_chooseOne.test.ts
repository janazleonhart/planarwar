// worldcore/test/contract_townQuestGenerator_rewardScaling_chooseOne.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { generateTownQuests } from "../quests/QuestGenerator";

test("[contract] generated quest rewards scale upward with tier for the same town+epoch", () => {
  const townId = "prime_shard:0,0";
  const epoch = "2026-W03";

  const t1 = generateTownQuests({ townId, tier: 1, epoch, maxQuests: 25, includeRepeatables: true, includeChainCatalog: true });
  const t4 = generateTownQuests({ townId, tier: 4, epoch, maxQuests: 25, includeRepeatables: true, includeChainCatalog: true });

  const q1 = t1.find((q) => q.id === "town_prime_shard_0_0_t1_rat_culling");
  const q4 = t4.find((q) => q.id === "town_prime_shard_0_0_t4_rat_culling");

  assert.ok(q1?.reward?.xp && q4?.reward?.xp, "Expected rat_culling to have xp rewards at both tiers");
  assert.ok((q4!.reward!.xp as number) > (q1!.reward!.xp as number), "Expected tier 4 rat_culling xp to exceed tier 1");
});

test("[contract] tier 4 crafted generated quests include choose-one bonus rewards", () => {
  const townId = "prime_shard:0,0";
  const epoch = "2026-W03";

  const t4 = generateTownQuests({ townId, tier: 4, epoch, maxQuests: 25, includeRepeatables: true, includeChainCatalog: true });
  const craft = t4.find((q) => q.id === "town_prime_shard_0_0_t4_alchemist_aid");

  assert.ok(craft?.reward, "Expected tier 4 alchemist_aid to have a reward");
  assert.ok(Array.isArray(craft!.reward!.chooseOne) && craft!.reward!.chooseOne!.length >= 2, "Expected chooseOne with at least 2 options");

  const labels = new Set((craft!.reward!.chooseOne ?? []).map((o) => String(o.label ?? "").trim()).filter(Boolean));
  assert.ok(labels.has("Bonus XP"), `Expected Bonus XP choice (got: ${Array.from(labels).join(", ")})`);
  assert.ok(labels.has("Bonus Gold"), `Expected Bonus Gold choice (got: ${Array.from(labels).join(", ")})`);
});
