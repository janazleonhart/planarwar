// worldcore/test/SongEngine.melody.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  getMelody,
  setMelodyActive,
  tickSongsForCharacter,
} from "../songs/SongEngine";
import {
  CharacterState,
  defaultAbilities,
  defaultAttributes,
  defaultEquipment,
  defaultInventory,
  defaultProgression,
  defaultSpellbook,
} from "../characters/CharacterTypes";
import type { MudContext } from "../mud/MudContext";
import type { EntityManager } from "../core/EntityManager";

function makeVirtuoso(level: number): CharacterState {
  return {
    id: "char_1",
    userId: "user_1",
    shardId: "prime_shard",
    name: "Virtuoso Tester",
    classId: "virtuoso",
    level,
    xp: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    lastRegionId: null,
    appearanceTag: null,
    attributes: defaultAttributes(),
    inventory: defaultInventory(),
    equipment: defaultEquipment(),
    spellbook: defaultSpellbook(),
    abilities: defaultAbilities(),
    progression: defaultProgression(),
    stateVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeContext(entity: any): MudContext {
  const session = { id: "sess_1", roomId: "room_1" } as any;
  const entities = {
    getEntityByOwner: () => entity,
  } as unknown as EntityManager;

  // Only the fields used by tickSongsForCharacter are populated
  return {
    session,
    entities,
  } as MudContext;
}

test("SongEngine tick casts active melody and advances index/timer", async () => {
  const char = makeVirtuoso(5);
  const entity = {
    id: "ent_1",
    ownerSessionId: "sess_1",
    type: "player",
    hp: 20,
    maxHp: 30,
  };
  const ctx = makeContext(entity);

  const melody = getMelody(char);
  melody.spellIds = [
    "virtuoso_song_rising_courage",
    "virtuoso_dissonant_battle_chant",
  ];
  melody.currentIndex = 0;
  setMelodyActive(char, true);

  const now = Date.now();
  const result = await tickSongsForCharacter(ctx, char, now);

  assert.ok(result && result.length > 0, "expected a song cast result");
  assert.equal(melody.currentIndex, 1, "melody should advance to next song");
  assert.ok(melody.nextCastAtMs > now, "next cast should be scheduled in the future");
});

test("SongEngine tick still works when playlist includes higher-level entries", async () => {
  // Level 2: can use rising_courage (min 1) but not dissonant_battle_chant (min 5)
  const char = makeVirtuoso(2);
  const entity = {
    id: "ent_2",
    ownerSessionId: "sess_2",
    type: "player",
    hp: 25,
    maxHp: 40,
  };
  const ctx = makeContext(entity);

  const melody = getMelody(char);
  melody.spellIds = [
    "virtuoso_song_rising_courage",
    "virtuoso_dissonant_battle_chant",
  ];
  melody.currentIndex = 0;
  setMelodyActive(char, true);

  const now = Date.now();
  const first = await tickSongsForCharacter(ctx, char, now);
  assert.ok(first && first.length > 0, "expected cast result for a valid song");
  assert.equal(melody.currentIndex, 1, "melody should progress to the next entry");
  assert.ok(melody.nextCastAtMs > now, "should schedule the next cast");

  const secondNow = melody.nextCastAtMs;
  const second = await tickSongsForCharacter(ctx, char, secondNow);

  // Over-level spell should give a message or cooldown text, not crash or null
  assert.ok(second !== null, "tick should return a message or cooldown notice, not null");
  assert.ok(
    melody.nextCastAtMs > secondNow,
    "next cast should be rescheduled after the second tick",
  );
});
