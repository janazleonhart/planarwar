// worldcore/test/contract_townQuestGeneratorObjectivePool.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { generateTownQuests } from "../quests/QuestGenerator";
import type { QuestObjective } from "../quests/QuestTypes";

test("[contract] generated quest objectives only use safe ids from the current content set", () => {
  const quests = generateTownQuests({ townId: "prime_shard:0,0", tier: 4, epoch: "2026-W03" });

  const allowedNpcIds = new Set(["npc_quartermaster"]);
  const allowedTargetProtoIds = new Set(["town_rat"]);
  const allowedNodeProtoIds = new Set([
    "ore_vein_small",
    "herb_peacebloom",
    "wood_oak",
    "stone_granite",
    "grain_wheat",
    "fish_river_trout",
    "mana_spark_arcane",
  ]);
  const allowedItemIds = new Set([
    "rat_tail",
    "herb_peacebloom",
    "wood_oak",
    "ore_iron_hematite",
    "stone_granite",
    "grain_wheat",
    "fish_river_trout",
    "mana_spark_arcane",
  ]);
  const allowedActionIds = new Set(["craft:brew_minor_heal"]);

  for (const q of quests) {
    assert.ok(Array.isArray(q.objectives) && q.objectives.length > 0, `Quest ${q.id} missing objectives`);

    for (const obj of q.objectives as QuestObjective[]) {
      switch (obj.kind) {
        case "talk_to":
          assert.ok(allowedNpcIds.has(obj.npcId), `Unexpected talk_to npcId: ${obj.npcId}`);
          break;

        case "kill":
          assert.ok(
            allowedTargetProtoIds.has(obj.targetProtoId),
            `Unexpected kill targetProtoId: ${obj.targetProtoId}`
          );
          break;

        case "harvest":
          assert.ok(
            allowedNodeProtoIds.has(obj.nodeProtoId),
            `Unexpected harvest nodeProtoId: ${obj.nodeProtoId}`
          );
          break;

        case "collect_item":
          assert.ok(allowedItemIds.has(obj.itemId), `Unexpected collect_item itemId: ${obj.itemId}`);
          break;

        case "craft":
          assert.ok(allowedActionIds.has(obj.actionId), `Unexpected craft actionId: ${obj.actionId}`);
          break;

        case "city":
          assert.fail(`Generator emitted unexpected city objective: ${JSON.stringify(obj)}`);
          break;

        default:
          assert.fail(`Unknown objective kind: ${(obj as any).kind}`);
      }

      const req = (obj as any).required;
      if (req !== undefined) {
        assert.ok(Number.isFinite(req) && req > 0, `Objective required must be >0 (got ${req})`);
      }
    }
  }
});

test("[contract] generated quest ids are unique and town-prefixed", () => {
  const townId = "prime_shard:0,0";
  const tier = 4;
  const epoch = "2026-W03";

  const quests = generateTownQuests({ townId, tier, epoch });
  assert.ok(quests.length > 0, "Expected at least one generated quest");

  const prefix = "town_prime_shard_0_0_t4_";
  const seen = new Set<string>();

  for (const q of quests) {
    assert.ok(q.id.startsWith(prefix), `Quest id not town-prefixed: ${q.id}`);
    assert.ok(!seen.has(q.id), `Duplicate quest id: ${q.id}`);
    seen.add(q.id);
  }
});
