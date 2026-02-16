// worldcore/test/contract_townQuestGenerator_objectiveSignatureVariety_softCap.test.ts
//
// Generator v0.22: objective signature variety (soft).
//
// Why this exists:
// - v0.21 semantic caps prevent repeating the same *targets*, but compound quests can
//   still feel repetitive if multiple offerings share the same objective-kind pattern
//   (e.g. harvest+collect repeated with different items).
// - v0.22 should prefer mixing objective signatures when the pool allows, while staying
//   deterministic and underfill-safe.

import test from "node:test";
import assert from "node:assert/strict";

import { generateTownQuests } from "../quests/QuestGenerator";

test("[contract] town quest generator prefers objective signature variety (v0.22)", () => {
  const mkHarvestCollectA = () => ({
    id: "contract_sig_harvest_collect_a",
    name: "Harvest+Collect A",
    description: "Contract kit: harvest then collect (A).",
    turninPolicy: "board" as const,
    turninBoardId: "contract_town",
    objectives: [
      // Use core ids that exist in seed catalogs (QuestGenerator pools).
      { kind: "harvest" as const, nodeProtoId: "herb_peacebloom", required: 2 },
      { kind: "collect_item" as const, itemId: "wood_oak", required: 2 },
    ],
    reward: { xp: 1 },
  });

  const mkHarvestCollectB = () => ({
    id: "contract_sig_harvest_collect_b",
    name: "Harvest+Collect B",
    description: "Contract kit: harvest then collect (B).",
    turninPolicy: "board" as const,
    turninBoardId: "contract_town",
    objectives: [
      { kind: "harvest" as const, nodeProtoId: "ore_vein_small", required: 2 },
      { kind: "collect_item" as const, itemId: "ore_iron_hematite", required: 2 },
    ],
    reward: { xp: 1 },
  });

  const mkKillCollect = () => ({
    id: "contract_sig_kill_collect",
    name: "Kill+Collect",
    description: "Contract kit: kill then collect.",
    turninPolicy: "board" as const,
    turninBoardId: "contract_town",
    objectives: [
      { kind: "kill" as const, targetProtoId: "training_dummy", required: 1 },
      { kind: "collect_item" as const, itemId: "dummy_splinter", required: 1 },
    ],
    reward: { xp: 1 },
  });

  const qs = generateTownQuests({
    townId: "contract_town",
    tier: 2,
    epoch: "epoch:test",
    // Give the generator enough room to include injected candidates alongside
    // the always-on onboarding quests.
    maxQuests: 6,
    includeRepeatables: false,
    includeChainCatalog: false,
    extraCandidates: [mkHarvestCollectA, mkHarvestCollectB, mkKillCollect],
  });

  const ids = new Set(qs.map((q) => q.id));

  // We should get the kill+collect signature (kill+collect_item) rather than
  // both harvest+collect variants (harvest+collect_item) in the same offering.
  assert.ok(
    ids.has("contract_sig_kill_collect"),
    `Expected kill+collect to be selected; got: ${[...ids].join(", ")}`,
  );

  const gotHarvestCollect =
    (ids.has("contract_sig_harvest_collect_a") ? 1 : 0) +
    (ids.has("contract_sig_harvest_collect_b") ? 1 : 0);

  // Sanity: at least one should be eligible/selected when room exists.
  assert.ok(
    gotHarvestCollect >= 1,
    `Expected at least 1 harvest+collect variant to be eligible; got=${gotHarvestCollect} ids=${[...ids].join(", ")}`,
  );

  // Core v0.22 claim: do not pick both of the same objective signature if alternatives exist.
  assert.ok(
    gotHarvestCollect <= 1,
    `Expected at most 1 harvest+collect variant due to signature cap; got=${gotHarvestCollect} ids=${[...ids].join(", ")}`,
  );
});
