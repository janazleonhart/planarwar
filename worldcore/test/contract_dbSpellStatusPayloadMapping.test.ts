// worldcore/test/contract_dbSpellStatusPayloadMapping.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { __mapDbRowToSpellDefForTest } from "../spells/SpellTypes";

function mkRow(partial: any): any {
  return {
    id: "test_spell",
    name: "Test Spell",
    description: "desc",
    kind: "damage_single_npc",
    class_id: "archmage",
    min_level: 1,
    school: "arcane",

    is_song: false,
    song_school: null,

    resource_type: "mana",
    resource_cost: 0,
    cooldown_ms: 0,

    damage_multiplier: null,
    flat_bonus: null,
    heal_amount: null,

    is_debug: false,
    is_enabled: true,
    is_dev_only: false,
    grant_min_role: "player",
    flags: {},
    tags: [],

    status_effect: null,
    cleanse: null,

    ...partial,
  };
}

test("[contract] db spell row mapping preserves status_effect + cleanse payloads", () => {
  const hotRow = mkRow({
    kind: "heal_hot_self",
    heal_amount: 20,
    status_effect: {
      id: "restorative_prayer_hot",
      durationMs: 10_000,
      maxStacks: 1,
      tags: ["buff", "hot", "holy"],
      hot: { tickIntervalMs: 2000, spreadHealingAcrossTicks: true },
    },
  });

  const hotSpell = __mapDbRowToSpellDefForTest(hotRow as any);
  assert.equal(hotSpell.kind, "heal_hot_self");
  assert.equal(hotSpell.healAmount, 20);
  assert.equal(hotSpell.statusEffect?.id, "restorative_prayer_hot");
  assert.equal(hotSpell.statusEffect?.hot?.tickIntervalMs, 2000);

  const cleanseRow = mkRow({
    kind: "cleanse_self",
    cleanse: { tags: ["debuff", "dot"], maxToRemove: 1 },
  });

  const cleanseSpell = __mapDbRowToSpellDefForTest(cleanseRow as any);
  assert.equal(cleanseSpell.kind, "cleanse_self");
  assert.deepEqual(cleanseSpell.cleanse, { tags: ["debuff", "dot"], maxToRemove: 1 });
});
