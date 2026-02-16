//worldcore/test/contract_townQuestGenerator_kindCaps_prevent_monotony.test.ts

import { test } from "node:test";
import assert from "node:assert";
import { generateTownQuests } from "../quests/QuestGenerator";
import type { QuestDefinition, QuestObjectiveKind } from "../quests/QuestTypes";

function mkKill(): QuestDefinition {
  return {
    id: "kind_caps_test_kill",
    name: "Kind Caps Test (Kill)",
    description: "Injected extra candidate: kill objective.",
    objectives: [{ kind: "kill", targetProtoId: "town_rat", required: 1 }],
    reward: { xp: 1 },
  };
}

function mkHarvest(): QuestDefinition {
  return {
    id: "kind_caps_test_harvest",
    name: "Kind Caps Test (Harvest)",
    description: "Injected extra candidate: harvest objective.",
    objectives: [{ kind: "harvest", nodeProtoId: "town_herb", required: 1 }],
    reward: { xp: 1 },
  };
}

function mkCollectItem(): QuestDefinition {
  return {
    id: "kind_caps_test_collect_item",
    name: "Kind Caps Test (Collect Item)",
    description: "Injected extra candidate: collect_item objective.",
    objectives: [{ kind: "collect_item", itemId: "rat_tail", required: 1 }],
    reward: { xp: 1 },
  };
}

function mkCraft(): QuestDefinition {
  return {
    id: "kind_caps_test_craft",
    name: "Kind Caps Test (Craft)",
    description: "Injected extra candidate: craft objective.",
    objectives: [{ kind: "craft", actionId: "recipe_rat_stew", required: 1 }],
    reward: { xp: 1 },
  };
}

function mkCity(): QuestDefinition {
  return {
    id: "kind_caps_test_city",
    name: "Kind Caps Test (City)",
    description: "Injected extra candidate: city objective.",
    objectives: [{ kind: "city", cityActionId: "city_action_test", required: 1 }],
    reward: { xp: 1 },
  };
}

function mkTalkTo(): QuestDefinition {
  return {
    id: "kind_caps_test_talk_to",
    name: "Kind Caps Test (Talk To)",
    description: "Injected extra candidate: talk_to objective.",
    objectives: [{ kind: "talk_to", npcId: "npc_quartermaster", required: 1 }],
    reward: { xp: 1 },
    turninPolicy: "npc",
    turninNpcId: "npc_quartermaster",
  };
}

test("[contract] town quest generator v0.13 caps filler objective kinds (no monotony, no underfill)", () => {
  const quests = generateTownQuests({
    townId: "prime_shard:0,0",
    tier: 3,
    epoch: "test_epoch",
    maxQuests: 6,
    includeRepeatables: true,
    // Ensure enough variety to fill all slots while enforcing caps.
    extraCandidates: [mkKill, mkHarvest, mkCollectItem, mkCraft, mkCity, mkTalkTo],
  });

  assert.equal(quests.length, 6);

  const counts = new Map<QuestObjectiveKind | "unknown", number>();
  for (const q of quests) {
    const k = (q.objectives?.[0]?.kind as QuestObjectiveKind | undefined) ?? "unknown";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  // For maxQuests<=6, the cap is 2 per objective kind (including core quests).
  for (const [kind, c] of counts.entries()) {
    assert.ok(
      c <= 2,
      `expected kind cap <=2 but got ${c} for kind=${kind}. Counts=${JSON.stringify(Object.fromEntries(counts))}`
    );
  }
});
