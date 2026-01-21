// worldcore/test/contract_songEngine_melodyAdvanceOnThrow.test.ts
//
// Harden the orchestration seam: SongEngine must advance melody index and schedule
// the next cast even if the cast path throws.
//
// Uses node:test like the rest of the suite.

import assert from "node:assert/strict";
import test from "node:test";

import { SPELLS } from "../spells/SpellTypes";
import { DEFAULT_MELODY_INTERVAL_MS, setMelody, setMelodyActive, tickSongsForCharacter } from "../songs/SongEngine";

test("[contract] SongEngine advances melody even when cast throws", async () => {
  const idA = "__test_song_throw_a";
  const idB = "__test_song_throw_b";

  // Inject two fake song defs so the engine has something to look up.
  (SPELLS as any)[idA] = {
    id: idA,
    name: "Test Song A",
    description: "test",
    kind: "heal",
    classId: "virtuoso",
    minLevel: 1,
    school: "arcane",
    isSong: true,
    songSchool: "voice",
    resourceType: "mana",
    resourceCost: 0,
    cooldownMs: 0,
    healAmount: 1,
    isDebug: false,
    isDevOnly: false,
    isEnabled: true,
  };

  (SPELLS as any)[idB] = {
    id: idB,
    name: "Test Song B",
    description: "test",
    kind: "heal",
    classId: "virtuoso",
    minLevel: 1,
    school: "arcane",
    isSong: true,
    songSchool: "voice",
    resourceType: "mana",
    resourceCost: 0,
    cooldownMs: 0,
    healAmount: 1,
    isDebug: false,
    isDevOnly: false,
    isEnabled: true,
  };

  try {
    const char: any = {
      id: "char_test",
      classId: "virtuoso",
      level: 1,
      progression: {},
      spellbook: { known: {} },
    };

    // Minimal MudContext shape SongEngine expects
    const ctx: any = {
      session: { id: "sess1" },
      entities: {
        getEntityByOwner: (_ownerId: string) => ({ hp: 10, alive: true }),
      },
    };

    // Set up melody
    setMelody(char, [idA, idB]);
    setMelodyActive(char, true);

    const now = 10_000;

    // Force a throw from the cast path
    const caster = async () => {
      throw new Error("boom");
    };

    const beforeIndex = char.progression.songs.melody.currentIndex;
    assert.equal(beforeIndex, 0);

    const r = await tickSongsForCharacter(ctx, char, now, caster as any);
    assert.equal(r, null, "Engine should swallow cast exceptions and return null");

    const after = char.progression.songs.melody;
    assert.equal(after.currentIndex, 1, "Melody should advance index even on throw");
    assert.equal(
      after.nextCastAtMs,
      now + (after.intervalMs ?? DEFAULT_MELODY_INTERVAL_MS),
      "Next cast should be scheduled deterministically",
    );
  } finally {
    delete (SPELLS as any)[idA];
    delete (SPELLS as any)[idB];
  }
});
