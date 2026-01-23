import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import type { SpellDefinition } from "../spells/SpellTypes";
import { castSpellForCharacter } from "../mud/MudSpells";
import { applyStatusEffect, computeCombatStatusSnapshot } from "../combat/StatusEffects";

function makeChar(name: string): CharacterState {
  return {
    id: "char_" + name.toLowerCase(),
    name,
    level: 1,
    classId: "cleric",
    xp: 0,
    xpToNextLevel: 100,
    attributes: { str: 5, dex: 5, int: 5, wis: 5, con: 5, cha: 5 },
    resources: {
      mana: { current: 0, max: 0 },
      stamina: { current: 0, max: 0 },
      energy: { current: 0, max: 0 },
    },
    spellbook: { spells: [], songs: [] },
    progression: {
      cooldowns: {},
      statusEffects: { active: {}, index: {} },
      songSkills: {},
    },
  } as any;
}

function makeCtx(selfSessionId: string, selfEntity: any) {
  return {
    session: { id: selfSessionId, shardId: "prime_shard", roomId: "prime_shard:0,0" },
    entities: {
      getEntityByOwner: (ownerSessionId: string) =>
        ownerSessionId === selfSessionId ? selfEntity : null,
    },
    items: {
      getEquipped: () => [],
    },
  } as any;
}

test("[contract] cleanse_self removes tagged debuffs from the caster", async () => {
  const realNow = Date.now;
  Date.now = () => 3_000_000;
  try {
    const char = makeChar("Caster");
    const selfSessionId = "sess_caster";

    const selfEntity = {
      id: "ent_caster",
      type: "player",
      name: "Caster",
      ownerSessionId: selfSessionId,
      shardId: "prime_shard",
      roomId: "prime_shard:0,0",
      hp: 50,
      maxHp: 50,
      alive: true,
      tags: [],
    };

    // Pre-apply a debuff
    applyStatusEffect(char, {
      id: "se_test_debuff",
      sourceKind: "spell",
      sourceId: "debuff_spell",
      name: "Weakened",
      durationMs: 10_000,
      maxStacks: 1,
      initialStacks: 1,
      modifiers: { damageTakenPct: 0.5 },
      tags: ["debuff"],
    });

    const before = computeCombatStatusSnapshot(char);
    assert.equal(before.damageTakenPct, 0.5);

    const spell: SpellDefinition = {
      id: "test_cleanse_self",
      name: "Test Cleanse",
      kind: "cleanse_self",
      description: "test",
      classId: "cleric",
      minLevel: 1,
      resourceType: "mana",
      resourceCost: 0,
      cooldownMs: 0,
      cleanse: { tags: ["debuff"] },
    };

    char.spellbook.spells.push({ spellId: spell.id, minLevel: 1 });
    const ctx = makeCtx(selfSessionId, selfEntity);

    const msg = await castSpellForCharacter(ctx, char, spell, "");
    assert.ok(msg.includes("cleanse") || msg.includes("Nothing") || msg.includes("You cleanse"), msg);

    const after = computeCombatStatusSnapshot(char);
    assert.equal(after.damageTakenPct, 0);
  } finally {
    Date.now = realNow;
  }
});
