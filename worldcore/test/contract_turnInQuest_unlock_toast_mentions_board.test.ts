// worldcore/test/contract_turnInQuest_unlock_toast_mentions_board.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { ensureQuestState } from "../quests/QuestState";
import { turnInQuest } from "../quests/turnInQuest";

type AnyCtx = any;

test("[contract] turnInQuest unlock toast mentions quest board", async () => {
  const roomId = "prime_shard:0,0";
  const ctx = makeCtx(roomId);
  const char = makeChar();

  // Mark the chain intro quest as READY (completed) so turn-in is allowed.
  const qs = ensureQuestState(char);
  qs["chain_intro_test"] = { state: "completed", source: { kind: "registry" } as any };

  const msg = await turnInQuest(ctx, char, "chain_intro_test");
  assert.match(msg, /Unlocked:/);
  assert.match(msg, /quest board/i);

  // Quest should be marked turned in.
  assert.equal(qs["chain_intro_test"].state, "turned_in");
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
