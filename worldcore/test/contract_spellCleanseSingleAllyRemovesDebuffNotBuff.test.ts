// worldcore/test/contract_spellCleanseSingleAllyRemovesDebuffNotBuff.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import type { SpellDefinition } from "../spells/SpellTypes";
import { castSpellForCharacter } from "../mud/MudSpells";
import { applyStatusEffect, getActiveStatusEffects } from "../combat/StatusEffects";

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

function makeCtx(selfSessionId: string, selfEntity: any, allySessionId: string, allyEntity: any, allyChar: CharacterState) {
  const selfSession: any = {
    id: selfSessionId,
    shardId: "prime_shard",
    roomId: "prime_shard:0,0",
    character: (null as any), // filled by caller
  };

  const allySession: any = {
    id: allySessionId,
    shardId: "prime_shard",
    roomId: "prime_shard:0,0",
    character: allyChar,
  };

  return {
    session: selfSession,
    sessions: {
      getAllSessions: () => [selfSession, allySession],
    },
    entities: {
      getEntityByOwner: (ownerSessionId: string) => {
        if (ownerSessionId === selfSessionId) return selfEntity;
        if (ownerSessionId === allySessionId) return allyEntity;
        return null;
      },
    },
    items: {
      getEquipped: () => [],
    },
  } as any;
}

test("[contract] cleanse_single_ally removes tagged debuffs but does not remove unrelated buffs", async () => {
  const realNow = Date.now;
  Date.now = () => 4_000_000;
  try {
    const caster = makeChar("Caster");
    const ally = makeChar("Ally");

    const casterSessionId = "sess_caster";
    const allySessionId = "sess_ally";

    const casterEntity: any = {
      id: "ent_caster",
      type: "player",
      name: "Caster",
      ownerSessionId: casterSessionId,
      shardId: "prime_shard",
      roomId: "prime_shard:0,0",
      hp: 50,
      maxHp: 50,
      alive: true,
      tags: [],
      x: 0,
      z: 0,
    };

    const allyEntity: any = {
      id: "ent_ally",
      type: "player",
      name: "Ally",
      ownerSessionId: allySessionId,
      shardId: "prime_shard",
      roomId: "prime_shard:0,0",
      hp: 50,
      maxHp: 50,
      alive: true,
      tags: [],
      x: 1,
      z: 0,
    };

    // Pre-apply one debuff and one buff to the ALLY.
    applyStatusEffect(ally, {
      id: "se_test_debuff",
      sourceKind: "spell",
      sourceId: "enemy_spell",
      name: "Hexed",
      durationMs: 10_000,
      maxStacks: 1,
      initialStacks: 1,
      modifiers: { damageTakenPct: 0.5 },
      tags: ["debuff"],
    }, 3_999_000);

    applyStatusEffect(ally, {
      id: "se_test_shield",
      sourceKind: "spell",
      sourceId: "friend_spell",
      name: "Ward",
      durationMs: 10_000,
      maxStacks: 1,
      initialStacks: 1,
      modifiers: {},
      tags: ["shield", "buff"],
      absorb: { amount: 10 },
    }, 3_998_000);

    const spell: SpellDefinition = {
      id: "test_cleanse_single_ally",
      name: "Test Cleanse Ally",
      kind: "cleanse_single_ally",
      description: "test",
      classId: "cleric",
      minLevel: 1,
      resourceType: "mana",
      resourceCost: 0,
      cooldownMs: 0,
      cleanse: { tags: ["debuff"], maxToRemove: 1 },
    };

    caster.spellbook.spells.push({ spellId: spell.id, minLevel: 1 });

    const ctx = makeCtx(casterSessionId, casterEntity, allySessionId, allyEntity, ally);
    (ctx as any).session.character = caster;

    const msg = await castSpellForCharacter(ctx, caster, spell, "Ally");
    assert.ok(msg.includes("cleanse") || msg.includes("Cleans"), msg);

    const after = getActiveStatusEffects(ally, 4_000_000);
    assert.equal(after.filter((e) => (e.tags ?? []).includes("debuff")).length, 0, "debuff should be removed");
    assert.equal(after.filter((e) => (e.tags ?? []).includes("shield")).length, 1, "shield buff should remain");
  } finally {
    Date.now = realNow;
  }
});
