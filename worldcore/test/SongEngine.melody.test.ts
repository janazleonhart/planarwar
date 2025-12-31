// worldcore/test/SongEngine.melody.test.ts

import assert from "node:assert/strict";
import test from "node:test";

import { EntityManager } from "../core/EntityManager";
import type { MudContext } from "../mud/MudContext";
import {
  getMelody,
  setMelody,
  setMelodyActive,
  tickSongsForCharacter,
} from "../songs/SongEngine";
import {
  defaultAttributes,
  defaultInventory,
  defaultEquipment,
  defaultSpellbook,
  defaultAbilities,
  defaultProgression,
  type CharacterState,
} from "../characters/CharacterTypes";

// ----------------------------------------
// Test helpers
// ----------------------------------------

function makeVirtuoso(level: number): CharacterState {
  const now = new Date();

  return {
    id: `char-virt-${level}`,
    userId: "user-1",
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
    createdAt: now,
    updatedAt: now,
    guildId: null,
  };
}

function makeContext(
  entities: EntityManager,
  sessionId = "sess-virt",
  roomId = "song-room"
): MudContext {
  const session = {
    id: sessionId,
    displayName: "Virtuoso",
    socket: {} as any,
    roomId,
    shardId: "prime_shard",
    lastSeen: Date.now(),
  } as any;

  const ctx: MudContext = {
    // Only the pieces SongEngine / MudSpells care about
    sessions: {} as any,
    guilds: {} as any,
    entities,
    session,
  };

  return ctx;
}

// ----------------------------------------
// Tests
// ----------------------------------------

test(
  "Virtuoso melody tick advances playlist and schedules casts",
  async () => {
    const entities = new EntityManager();
    const ctx = makeContext(entities);

    // Needed so tickSongsForCharacter sees a living body
    entities.createPlayerForSession(ctx.session.id, ctx.session.roomId!);

    const char = makeVirtuoso(5); // high enough for all starter songs

    // Two valid Virtuoso songs
    setMelody(char, [
      "virtuoso_song_rising_courage",
      "virtuoso_hymn_woven_recovery",
    ]);
    setMelodyActive(char, true);

    const now = Date.now();
    const result = await tickSongsForCharacter(ctx, char, now);

    const melody = getMelody(char);

    // After one tick we should have advanced from index 0 → 1
    assert.equal(
      melody.currentIndex,
      1,
      "melody should advance to the next song index"
    );
    assert.ok(
      melody.nextCastAtMs > now,
      "melody.nextCastAtMs should be scheduled in the future"
    );
    assert.equal(melody.isActive, true, "melody should remain active");
    // We only care that it didn't throw; the spell path can return a string or null
    assert.ok(typeof result === "string" || result === null);
  }
);

test(
  "Melody handles over-level songs without crashing",
  async () => {
    const entities = new EntityManager();
    const ctx = makeContext(entities, "sess-virt-2", "song-room-2");

    entities.createPlayerForSession(ctx.session.id, ctx.session.roomId!);

    const char = makeVirtuoso(2); // below some song levels

    // Include one song the character is under-level for
    setMelody(char, [
      "virtuoso_song_rising_courage",      // usable at level 1
      "virtuoso_dissonant_battle_chant",  // requires level 5
    ]);
    setMelodyActive(char, true);

    const now = Date.now();
    const result = await tickSongsForCharacter(ctx, char, now);

    const melody = getMelody(char);

    // Even if a song is over-level, the playlist should still tick forward
    assert.equal(
      melody.currentIndex,
      1,
      "melody should advance index even when a song is over-level"
    );
    assert.ok(
      melody.nextCastAtMs > now,
      "melody should still schedule the next cast"
    );
    assert.ok(typeof result === "string" || result === null);
  }
);
