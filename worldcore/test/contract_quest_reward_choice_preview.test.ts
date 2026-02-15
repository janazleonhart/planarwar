// worldcore/test/contract_quest_reward_choice_preview.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { renderQuestDetails } from "../quests/QuestText";
import { ensureQuestState } from "../quests/QuestState";

type AnyCtx = any;

test("[contract] quest show renders choose-one reward options", async () => {
  const roomId = "prime_shard:0,0";
  const ctx = makeCtx(roomId);
  const char = makeChar();

  const qs = ensureQuestState(char);
  qs["reward_choice_test"] = { state: "completed", source: { kind: "registry" } as any };

  const out = renderQuestDetails(char, "reward_choice_test", { ctx });
  assert.match(out, /Rewards:/);
  assert.match(out, /Choose one:/);
  assert.match(out, /\(1\)/);
  assert.match(out, /\(2\)/);
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
    getEntitiesInRoom: (_rid: string) => [playerEntity],
  };

  const rooms = {
    getRoom: (rid: string) =>
      rid === roomId
        ? { id: rid, regionId: "town_alpha", tags: ["starter", "town_tier_1"] }
        : null,
  };

  return { session, entities, rooms } as AnyCtx;
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
