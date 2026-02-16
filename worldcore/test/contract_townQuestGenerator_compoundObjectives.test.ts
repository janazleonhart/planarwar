// worldcore/test/contract_townQuestGenerator_compoundObjectives.test.ts
//
// Generator v0.6: compound (multi-objective) generated quests exist and are deterministic.

import test from "node:test";
import assert from "node:assert/strict";

import { generateTownQuests } from "../quests/QuestGenerator";

test("[contract] generator can emit compound multi-objective quests (tier 2+)", () => {
  const townId = "prime_shard:0,0";
  const epoch = "2026-W03";

  const qs = generateTownQuests({
    townId,
    tier: 2,
    epoch,
    maxQuests: 50,
    includeRepeatables: true,
    includeChainCatalog: true,
  });

  const compound = qs.find((q) => q.id === "town_prime_shard_0_0_t2_pest_control_supplies");
  assert.ok(compound, "Expected pest_control_supplies quest at tier 2");

  assert.ok(Array.isArray(compound!.objectives), "Expected objectives array");
  assert.ok((compound!.objectives as any[]).length >= 2, "Expected at least 2 objectives");

  const kinds = (compound!.objectives as any[]).map((o) => o.kind).sort();
  assert.deepEqual(kinds, ["collect_item", "kill"].sort(), "Expected kill + collect_item objectives");

  assert.ok(compound!.reward?.xp && (compound!.reward!.xp as number) > 0, "Expected compound reward xp > 0");
});

test("[contract] compound quests are deterministic for same town+tier+epoch", () => {
  const townId = "prime_shard:0,0";
  const epoch = "2026-W03";

  const a = generateTownQuests({ townId, tier: 2, epoch, maxQuests: 50, includeRepeatables: true, includeChainCatalog: true });
  const b = generateTownQuests({ townId, tier: 2, epoch, maxQuests: 50, includeRepeatables: true, includeChainCatalog: true });

  const qa = a.find((q) => q.id === "town_prime_shard_0_0_t2_pest_control_supplies");
  const qb = b.find((q) => q.id === "town_prime_shard_0_0_t2_pest_control_supplies");

  assert.ok(qa && qb, "Expected compound quest in both generations");
  assert.equal(JSON.stringify(qa), JSON.stringify(qb), "Expected identical quest definitions for deterministic generation");
});
