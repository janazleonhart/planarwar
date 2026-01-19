// worldcore/test/contract_townQuestGeneratorDeterminism.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { generateTownQuests, stableQuestGenSeed } from "../quests/QuestGenerator";

test("[contract] town quest generator is deterministic for identical inputs", () => {
  const a = generateTownQuests({ townId: "prime_shard:0,0", tier: 3, epoch: "2026-W03" });
  const b = generateTownQuests({ townId: "prime_shard:0,0", tier: 3, epoch: "2026-W03" });

  assert.deepStrictEqual(a, b);
});

test("[contract] different epoch changes output (seeded variance)", () => {
  const seedA = stableQuestGenSeed({ townId: "prime_shard:0,0", tier: 4, epoch: "2026-W03" });
  const seedB = stableQuestGenSeed({ townId: "prime_shard:0,0", tier: 4, epoch: "2026-W04" });

  assert.notStrictEqual(seedA, seedB, "Expected epoch to influence stable seed");

  const a = generateTownQuests({ townId: "prime_shard:0,0", tier: 4, epoch: "2026-W03" });
  const b = generateTownQuests({ townId: "prime_shard:0,0", tier: 4, epoch: "2026-W04" });

  assert.notDeepStrictEqual(a, b, "Expected epoch rotation to change generated quest set");
});
