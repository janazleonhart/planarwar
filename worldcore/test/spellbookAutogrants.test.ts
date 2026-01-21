// worldcore/test/spellbookAutogrants.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  ensureSpellbookAutogrants,
  getKnownSpellsForChar,
} from "../spells/SpellTypes";

test("[spellbook] auto-grants universal + class spells", () => {
  const char: any = { classId: "mage", level: 1, spellbook: {} };

  ensureSpellbookAutogrants(char, 123);

  const ids = getKnownSpellsForChar(char, { kind: "spells" }).map((s) => s.id);

  assert.ok(ids.includes("arcane_bolt"), "expected arcane_bolt to be auto-granted");
  assert.ok(ids.includes("mage_fire_bolt"), "expected mage_fire_bolt to be auto-granted");
  assert.ok(!ids.includes("cleric_minor_heal"), "did not expect cleric spell for mage");
});

test("[spellbook] leveling up grants newly-eligible songs", () => {
  const char: any = { classId: "virtuoso", level: 1, spellbook: {} };

  ensureSpellbookAutogrants(char, 123);
  let songIds = getKnownSpellsForChar(char, { kind: "songs" }).map((s) => s.id);

  assert.ok(
    songIds.includes("virtuoso_song_rising_courage"),
    "expected starter song to be auto-granted",
  );
  assert.ok(
    !songIds.includes("virtuoso_hymn_woven_recovery"),
    "did not expect L3 song at L1",
  );

  char.level = 3;
  ensureSpellbookAutogrants(char, 123);
  songIds = getKnownSpellsForChar(char, { kind: "songs" }).map((s) => s.id);

  assert.ok(
    songIds.includes("virtuoso_hymn_woven_recovery"),
    "expected L3 song after leveling",
  );
});

test("[spellbook] debug spells are not auto-granted", () => {
  const char: any = { classId: "mage", level: 99, spellbook: {} };

  ensureSpellbookAutogrants(char, 123);

  const known: any = (char.spellbook && (char.spellbook as any).known) || {};
  assert.ok(!known["debug_arcane_bolt"], "debug spells should not be auto-granted");
});
