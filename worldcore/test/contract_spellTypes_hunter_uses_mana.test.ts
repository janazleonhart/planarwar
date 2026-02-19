// worldcore/test/contract_spellTypes_hunter_uses_mana.test.ts
//
// Contract: Hunter reference kit uses mana as its primary resource.
// (Design choice: classic spell-based hunter, not focus/fury.)

import test from "node:test";
import assert from "node:assert/strict";

import { SPELLS } from "../spells/SpellTypes";

const HUNTER_REF_SPELL_IDS = [
  "hunter_steady_shot",
  "hunter_serrated_arrow",
  "hunter_hunters_mark",
  "hunter_field_dressing",
  "hunter_aimed_shot",
] as const;

test("[contract] SpellTypes: Hunter reference kit uses mana", () => {
  for (const id of HUNTER_REF_SPELL_IDS) {
    const spell = SPELLS[id];
    assert.ok(spell, `expected SPELLS to contain ${id}`);
    assert.equal(
      spell.resourceType,
      "mana",
      `expected ${id}.resourceType to be mana, got ${String((spell as any).resourceType)}`,
    );
  }
});
