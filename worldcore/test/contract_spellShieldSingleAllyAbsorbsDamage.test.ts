// worldcore/test/contract_spellShieldSingleAllyAbsorbsDamage.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import type { SpellDefinition } from "../spells/SpellTypes";
import { castSpellForCharacter } from "../mud/MudSpells";
import { applySimpleDamageToPlayer } from "../combat/entityCombat";
import { getActiveStatusEffects } from "../combat/StatusEffects";

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

test("[contract] shield_single_ally absorbs damage on the target character (depletes + removes)", async () => {
  const realNow = Date.now;
  Date.now = () => 5_000_000;
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

    const spell: SpellDefinition = {
      id: "test_shield_single_ally",
      name: "Test Shield Ally",
      kind: "shield_single_ally",
      description: "test",
      classId: "cleric",
      minLevel: 1,
      resourceType: "mana",
      resourceCost: 0,
      cooldownMs: 0,
      statusEffect: {
        id: "se_ally_ward",
        name: "Ally Ward",
        durationMs: 10_000,
        modifiers: {},
        tags: ["shield"],
        absorb: { amount: 10 },
      },
    };

    caster.spellbook.spells.push({ spellId: spell.id, minLevel: 1 });

    const ctx = makeCtx(casterSessionId, casterEntity, allySessionId, allyEntity, ally);
    (ctx as any).session.character = caster;

    const msg = await castSpellForCharacter(ctx, caster, spell, "Ally");
    assert.ok(msg.includes("ward") || msg.includes("Ward"), msg);

    // Hit for 8: fully absorbed, hp unchanged.
    applySimpleDamageToPlayer(allyEntity, 8, ally, "physical", { ignoreServiceProtection: true });
    assert.equal(allyEntity.hp, 50);

    // Hit for 5: remaining shield is 2, so 3 goes through.
    applySimpleDamageToPlayer(allyEntity, 5, ally, "physical", { ignoreServiceProtection: true });
    assert.equal(allyEntity.hp, 47);

    // Shield should be depleted + removed from ally.
    const after = getActiveStatusEffects(ally, 5_000_000);
    assert.equal(after.filter((e) => (e.tags ?? []).includes("shield")).length, 0);
  } finally {
    Date.now = realNow;
  }
});
