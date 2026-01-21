// worldcore/test/contract_songInstrumentGearBonus.test.ts
//
// Deterministic contract: instrument gear bonuses must affect song scaling.
// This avoids "RNG vibes" when verifying in-game.

import test from "node:test";
import assert from "node:assert/strict";

import { castSpellForCharacter } from "../mud/MudSpells";
import { gainSongSchoolSkill } from "../skills/SkillProgression";

function extractHealedAmount(msg: string): number {
  const m = msg.match(/You restore\s+(\d+)\s+health\./i);
  if (!m) {
    throw new Error(`Expected heal message, got: ${msg}`);
  }
  return Number(m[1]);
}

function makeChar(spellId: string): any {
  const char: any = {
    id: "char_test",
    name: "TestBard",
    classId: "virtuoso",
    level: 50,
    spellbook: { known: { [spellId]: {} }, cooldowns: {} },
    equipment: {},
    progression: {},
  };

  // Ensure a stable, known song skill level (voice=100 => skillFactor=2.0)
  gainSongSchoolSkill(char, "voice" as any, 100);

  return char;
}

function makeCtx(selfEntity: any, items?: any): any {
  return {
    session: { id: "sess_test", roomId: "prime_shard:0,0" },
    entities: {
      getEntityByOwner: (_ownerId: string) => selfEntity,
    },
    items,
  };
}

test("[contract] instrument gear bonus increases song healing deterministically", async () => {
  // Custom spell so we can set resourceCost/cooldown to 0 (pure scaling test).
  const spell: any = {
    id: "test_song_heal",
    name: "Test Song Heal",
    description: "A test-only heal song.",
    classId: "virtuoso",
    minLevel: 1,
    isEnabled: true,
    isSong: true,
    songSchool: "voice",
    kind: "heal_self",
    healAmount: 10,
    resourceCost: 0,
    cooldownMs: 0,
  };

  // --- Baseline: no instrument equipped ---
  const charBase = makeChar(spell.id);
  const selfBase: any = { id: "ent_base", hp: 1, maxHp: 100, alive: true };
  const msgBase = await castSpellForCharacter(
    makeCtx(selfBase, { get: () => null }),
    charBase,
    spell,
    ""
  );
  const healedBase = extractHealedAmount(msgBase);
  assert.equal(healedBase, 20, "Expected 10 * (1 + 100/100) = 20 with no instrument bonus");

  // --- Instrument: +50% bonus to voice school ---
  const charInstr = makeChar(spell.id);
  charInstr.equipment = { mainhand: { itemId: "instrument_lute_basic", qty: 1 } };

  const itemService = {
    get: (id: string) => {
      if (id !== "instrument_lute_basic") return null;
      return { id, stats: { instrumentPctBySchool: { voice: 0.5 } } };
    },
  };

  const selfInstr: any = { id: "ent_instr", hp: 1, maxHp: 100, alive: true };
  const msgInstr = await castSpellForCharacter(
    makeCtx(selfInstr, itemService),
    charInstr,
    spell,
    ""
  );
  const healedInstr = extractHealedAmount(msgInstr);
  assert.equal(
    healedInstr,
    30,
    "Expected 10 * (1 + 100/100) * (1 + 0.5) = 30 with instrument bonus"
  );
});
