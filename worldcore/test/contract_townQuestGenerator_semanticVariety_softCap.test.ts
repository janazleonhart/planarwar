// worldcore/test/contract_townQuestGenerator_semanticVariety_softCap.test.ts
//
// Generator v0.20: the offering should prefer semantic variety for the *primary target*
// of the primary objective (tier 2+), while remaining deterministic and underfill-safe.
//
// This is intentionally a soft contract: we do not require perfection, we just want
// to avoid obvious repeats when the pool provides alternatives.

import test from "node:test";
import assert from "node:assert/strict";

import { generateTownQuests } from "../quests/QuestGenerator";

function semanticKey(q: any): string | null {
  const o = q?.objectives?.[0];
  if (!o || typeof o.kind !== "string") return null;
  switch (o.kind) {
    case "kill":
      return typeof o.targetProtoId === "string" ? `kill:${o.targetProtoId}` : null;
    case "harvest":
      return typeof o.nodeProtoId === "string" ? `harvest:${o.nodeProtoId}` : null;
    case "collect_item":
      return typeof o.itemId === "string" ? `collect_item:${o.itemId}` : null;
    case "talk_to":
      return typeof o.npcId === "string" ? `talk_to:${o.npcId}` : null;
    default:
      return null;
  }
}

test("[contract] town quest generator prefers semantic variety of primary targets (tier 2+)", () => {
  const qs = generateTownQuests({
    townId: "prime_shard:0,0",
    tier: 2,
    epoch: "2026-W03",
    maxQuests: 6,
    includeRepeatables: true,
    includeChainCatalog: false,
  });

  // Ignore the always-on onboarding quests; they are intentionally sticky.
  const filtered = qs.filter((q) =>
    !String(q.id).endsWith("greet_quartermaster") && !String(q.id).endsWith("rat_culling"),
  );

  const keys: string[] = [];
  for (const q of filtered) {
    const k = semanticKey(q);
    if (k) keys.push(k);
  }

  // If we have enough semantic-keyed quests, we should not see pathological repetition.
  // Soft target: for a 6-slot tier-2 board, we expect at least 3 unique semantic keys
  // among the non-sticky quests, when the pool provides them.
  const uniq = new Set(keys);
  if (keys.length >= 3) {
    assert.ok(uniq.size >= 3, `Expected >= 3 unique semantic keys; got: ${keys.join(", ")}`);
  }
});
