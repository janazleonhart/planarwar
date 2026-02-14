// worldcore/test/contract_questLog_ready_rewardPreview.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { acceptTownQuest, resolveQuestDefinitionFromStateId } from "../quests/TownQuestBoard";
import { renderQuestLog } from "../quests/QuestText";
import { updateQuestsFromProgress } from "../quests/QuestEngine";
import { ensureQuestState } from "../quests/QuestState";

type AnyCtx = any;

test("[contract] quest log marks READY and shows reward preview for completed quests", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "test_epoch";

  try {
    const roomId = "prime_shard:0,0";
    const ctx = makeCtx(roomId);
    const char = makeChar();

    // Accept the first deterministic town quest.
    await acceptTownQuest(ctx, char, "1");

    const state = ensureQuestState(char);
    const ids = Object.keys(state);
    assert.equal(ids.length, 1);

    // Satisfy all objectives using the quest definition itself (deterministic, no guessing).
    const qid = ids[0];
    const entry = state[qid];
    const quest = resolveQuestDefinitionFromStateId(qid, entry);
    assert.ok(quest, "Expected accepted quest definition to resolve");

    char.progression = char.progression ?? {};
    (char.progression as any).kills = { ...(char.progression as any).kills };
    (char.progression as any).harvests = { ...(char.progression as any).harvests };
    (char.progression as any).actions = { ...(char.progression as any).actions };
    (char.progression as any).flags = { ...(char.progression as any).flags };

    for (const obj of quest!.objectives ?? []) {
      switch (obj.kind) {
        case "kill":
          (char.progression as any).kills[obj.targetProtoId] = obj.required;
          break;
        case "harvest":
          (char.progression as any).harvests[obj.nodeProtoId] = obj.required;
          break;
        case "craft":
          (char.progression as any).actions[obj.actionId] = obj.required;
          break;
        case "city":
          (char.progression as any).actions[obj.cityActionId] = obj.required;
          break;
        case "talk_to": {
          const key = `talked_to:${obj.npcId}`;
          (char.progression as any).flags[key] = obj.required ?? 1;
          break;
        }
        case "collect_item": {
          // Inventory is modeled as a list of { itemId, count } in tests.
          char.inventory = [{ itemId: obj.itemId, count: obj.required }];
          break;
        }
      }
    }

    updateQuestsFromProgress(char);

    const log = renderQuestLog(char);
    assert.match(log, /\[READY\]/);
    assert.match(log, /Rewards:/);
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});

function makeCtx(roomId: string): AnyCtx {
  const session = { id: "sess1", roomId, auth: { isDev: true } };

  const playerEntity = {
    id: "player_ent",
    type: "player",
    ownerSessionId: session.id,
    roomId,
    x: 0,
    z: 0,
    name: "Player",
  };

  const entities = {
    getEntityByOwner: (sid: string) => (sid === session.id ? playerEntity : null),
  };

  const rooms = {
    getRoom: (rid: string) =>
      rid === roomId
        ? {
            id: rid,
            regionId: rid,
            tags: ["starter", "town_tier_1"],
          }
        : null,
  };

  const characters = {
    patchCharacter: async () => {},
  };

  return { session, entities, rooms, characters } as AnyCtx;
}

function makeChar(): any {
  return {
    userId: "user1",
    id: "char1",
    progression: {},
    inventory: [],
    bags: [],
  };
}
