// worldcore/test/contract_turnInQuest_requires_choice.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { ensureQuestState } from "../quests/QuestState";
import { turnInQuest } from "../quests/turnInQuest";

type AnyCtx = any;

test("[contract] quest turn-in requires a choice when choose-one rewards exist", async () => {
  const roomId = "prime_shard:0,0";
  const ctx = makeCtx(roomId);
  const char = makeChar();

  const qs = ensureQuestState(char);
  qs["reward_choice_test"] = { state: "completed", source: { kind: "registry" } as any };

  const deny = await turnInQuest(ctx, char, "reward_choice_test");
  assert.match(deny, /requires choosing a reward/i);
  assert.match(deny, /choose <#>/i);
  assert.match(deny, /\(1\)/);

  const ok = await turnInQuest(ctx, char, "reward_choice_test choose 1");
  assert.match(ok, /You receive 5 gold\./);

  // Quest should be marked turned in.
  assert.equal(qs["reward_choice_test"].state, "turned_in");
});

function makeCtx(roomId: string): AnyCtx {
  const session = { id: "sess1", roomId, auth: { isDev: true }, identity: { userId: "user1" } };

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

  const characters = {
    patchCharacter: async () => {},
    grantXp: async (_userId: string, _charId: string, _xp: number) => null,
  };

  return { session, entities, rooms, characters } as AnyCtx;
}

function makeChar(): any {
  return {
    userId: "user1",
    id: "char1",
    progression: {
      kills: { training_dummy: 1 },
      quests: {},
    },
    inventory: [],
    bags: [],
  };
}
