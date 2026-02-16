// worldcore/test/contract_townQuestGenerator_semanticFamilyVariety_softCap.test.ts
//
// Generator v0.23: semantic "family" variety (soft).
//
// Why this exists:
// - v0.21 semantic caps prevent repeating the same exact targets, but a board can still
//   spam the same *resource family* in multiple shapes (e.g. harvest herb + turn-in herb).
// - v0.23 should prefer mixing resource families when alternatives exist, while staying
//   deterministic and underfill-safe.

import test from "node:test";
import assert from "node:assert/strict";

import { generateTownQuests } from "../quests/QuestGenerator";

test("[contract] town quest generator prefers resource-family variety (v0.23)", () => {
  const mkHarvestHerb = () => ({
    id: "contract_fam_harvest_herb",
    name: "Harvest Herb",
    description: "Contract kit: harvest an herb.",
    turninPolicy: "board" as const,
    turninBoardId: "contract_town",
    objectives: [{ kind: "harvest" as const, nodeProtoId: "herb_peacebloom", required: 2 }],
    reward: { xp: 1 },
  });

  const mkTurninHerb = () => ({
    id: "contract_fam_turnin_herb",
    name: "Turn-in Herb",
    description: "Contract kit: deliver an herb item.",
    turninPolicy: "board" as const,
    turninBoardId: "contract_town",
    objectives: [{ kind: "collect_item" as const, itemId: "herb_peacebloom", required: 2 }],
    reward: { xp: 1 },
  });

  const mkHarvestOre = () => ({
    id: "contract_fam_harvest_ore",
    name: "Harvest Ore",
    description: "Contract kit: harvest ore.",
    turninPolicy: "board" as const,
    turninBoardId: "contract_town",
    objectives: [{ kind: "harvest" as const, nodeProtoId: "ore_vein_small", required: 2 }],
    reward: { xp: 1 },
  });

  const mkTurninWood = () => ({
    id: "contract_fam_turnin_wood",
    name: "Turn-in Wood",
    description: "Contract kit: deliver wood.",
    turninPolicy: "board" as const,
    turninBoardId: "contract_town",
    objectives: [{ kind: "collect_item" as const, itemId: "wood_oak", required: 2 }],
    reward: { xp: 1 },
  });

  const qs = generateTownQuests({
    townId: "contract_town",
    tier: 2,
    epoch: "epoch:test",
    maxQuests: 6,
    includeRepeatables: false,
    includeChainCatalog: false,
    extraCandidates: [mkHarvestHerb, mkTurninHerb, mkHarvestOre, mkTurninWood],
  });

  const ids = new Set(qs.map((q) => q.id));

  // v0.23 is about avoiding *multiple shapes* of the same resource family when alternatives exist.
  // In particular: if the core pool already selected a herb-harvest quest, we should avoid also
  // selecting a herb *turn-in* quest when non-herb options exist.
  const isHerbHarvestObjective = (obj: any): boolean => {
    return obj?.kind === "harvest" && typeof obj.nodeProtoId === "string" && obj.nodeProtoId.startsWith("herb_");
  };

  const isHerbCollectObjective = (obj: any): boolean => {
    return obj?.kind === "collect_item" && typeof obj.itemId === "string" && obj.itemId.startsWith("herb_");
  };

  const herbHarvestQuestCount = qs.filter((q: any) => (q.objectives ?? []).some(isHerbHarvestObjective)).length;
  const herbCollectQuestCount = qs.filter((q: any) => (q.objectives ?? []).some(isHerbCollectObjective)).length;

  // Sanity: Tier-2 boards almost always include at least one herb harvest quest from the core pool.
  assert.ok(
    herbHarvestQuestCount >= 1,
    `Expected at least one herb-harvest quest to be selected; got=${herbHarvestQuestCount} ids=${[...ids].join(", ")}`,
  );

  // Core v0.23 claim (practical form): don't double-dip herb-family by adding a herb *turn-in*
  // quest when a herb harvest quest is already present and non-herb candidates exist.
  assert.strictEqual(
    herbCollectQuestCount,
    0,
    `Expected no herb collect_item quests due to family cap; got=${herbCollectQuestCount} ids=${[...ids].join(", ")}`,
  );

  // Confirm the injected herb turn-in candidate was deprioritized when a herb harvest quest was already present.
  assert.ok(
    !ids.has("contract_fam_turnin_herb"),
    `Expected contract_fam_turnin_herb to be deprioritized by family cap; ids=${[...ids].join(", ")}`,
  );

  // Ensure we still can pick non-herb variants from our injected pool.
  assert.ok(
    ids.has("contract_fam_harvest_ore") || ids.has("contract_fam_turnin_wood"),
    `Expected at least one non-herb candidate to be selected; ids=${[...ids].join(", ")}`,
  );
});
