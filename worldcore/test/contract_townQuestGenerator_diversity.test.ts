// worldcore/test/contract_townQuestGenerator_diversity.test.ts
//
// Generator v0.9: the offering should prefer diversity of objective kinds (tier 2+)
// while remaining deterministic.

import test from "node:test";
import assert from "node:assert/strict";

import { generateTownQuests } from "../quests/QuestGenerator";

test("[contract] town quest generator prefers diverse objective kinds (tier 2+)", () => {
  const townId = "prime_shard:0,0";
  const epoch = "2026-W03";

  const qs = generateTownQuests({
    townId,
    tier: 2,
    epoch,
    maxQuests: 6,
    includeRepeatables: true,
    includeChainCatalog: false,
  });

  const kinds = new Set<string>();
  for (const q of qs) {
    const k = String((q as any)?.objectives?.[0]?.kind ?? "").trim();
    if (k) kinds.add(k);
  }

  // We don't demand perfection; just avoid pathological monotony.
  assert.ok(kinds.size >= 3, `Expected >= 3 distinct objective kinds, got ${[...kinds].join(", ")}`);
});
