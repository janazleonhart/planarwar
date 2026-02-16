// worldcore/test/contract_townQuestGenerator_semanticVariety_allObjectives_softCap.test.ts
//
// Generator v0.21: extend semantic variety (soft) to *all objectives*.
//
// Why this exists:
// - v0.20 only considered the primary objective, so compound quests could still
//   accidentally spam the same secondary objective (e.g. "talk_to npc_quartermaster").
// - v0.21 should prefer a candidate whose *secondary* objective is semantically distinct
//   from quests already on the board, while remaining deterministic and underfill-safe.

import test from "node:test";
import assert from "node:assert/strict";

import { generateTownQuests } from "../quests/QuestGenerator";

test("[contract] town quest generator semantic cap applies to secondary objectives (v0.21)", () => {
  const mkQm = () => ({
    id: "contract_dummy_report_qm",
    name: "Dummy Report (QM)",
    description: "Hit the dummy, then report to the quartermaster.",
    turninPolicy: "board" as const,
    turninBoardId: "contract_town",
    objectives: [
      { kind: "kill" as const, targetProtoId: "training_dummy", required: 1 },
      { kind: "talk_to" as const, npcId: "npc_quartermaster", required: 1 },
    ],
    reward: { xp: 1 },
  });

  const mkTrainer = () => ({
    id: "contract_dummy_report_trainer",
    name: "Dummy Report (Trainer)",
    description: "Hit the dummy, then report to the trainer.",
    turninPolicy: "board" as const,
    turninBoardId: "contract_town",
    objectives: [
      { kind: "kill" as const, targetProtoId: "training_dummy", required: 1 },
      { kind: "talk_to" as const, npcId: "trainer_aria", required: 1 },
    ],
    reward: { xp: 1 },
  });

  const qs = generateTownQuests({
    townId: "contract_town",
    tier: 1,
    epoch: "epoch:test",
    maxQuests: 3,
    includeRepeatables: false,
    includeChainCatalog: false,
    extraCandidates: [mkQm, mkTrainer],
  });

  // The board always includes greet_quartermaster, so a candidate that also includes
  // talk_to npc_quartermaster should be deprioritized (softly) vs the trainer variant.
  const ids = new Set(qs.map((q) => q.id));

  assert.ok(
    ids.has("contract_dummy_report_trainer"),
    `Expected trainer variant to be preferred; got ids: ${Array.from(ids).join(", ")}`,
  );

  assert.ok(
    !ids.has("contract_dummy_report_qm"),
    `Did not expect quartermaster-secondary variant to be selected; got ids: ${Array.from(ids).join(", ")}`,
  );
});
