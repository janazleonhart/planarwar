// worldcore/test/contract_spellHotSingleAllyTicks.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import type { SpellDefinition } from "../spells/SpellTypes";
import { castSpellForCharacter } from "../mud/MudSpells";
import { tickStatusEffectsAndApplyHots } from "../combat/StatusEffects";

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

function makeCtx(opts: {
  casterSessionId: string;
  casterEntity: any;
  casterChar: CharacterState;
  allySessionId: string;
  allyEntity: any;
  allyChar: CharacterState;
}) {
  const { casterSessionId, casterEntity, casterChar, allySessionId, allyEntity, allyChar } = opts;

  const casterSession = { id: casterSessionId, shardId: "prime_shard", roomId: "prime_shard:0,0", character: casterChar };
  const allySession = { id: allySessionId, shardId: "prime_shard", roomId: "prime_shard:0,0", character: allyChar };

  return {
    session: casterSession,
    sessions: {
      getAllSessions: () => [casterSession, allySession],
    },
    entities: {
      getEntityByOwner: (ownerSessionId: string) => {
        if (ownerSessionId === casterSessionId) return casterEntity;
        if (ownerSessionId === allySessionId) return allyEntity;
        return null;
      },
    },
    items: {
      getEquipped: () => [],
    },
  } as any;
}

test("[contract] heal_hot_single_ally applies a HOT status on the ally and ticks healing deterministically", async () => {
  const realNow = Date.now;
  Date.now = () => 2_000_000;
  try {
    const caster = makeChar("Caster");
    const ally = makeChar("Ally");

    const casterSessionId = "sess_caster";
    const allySessionId = "sess_ally";

    const casterEntity = {
      id: "ent_caster",
      type: "player",
      name: "Caster",
      ownerSessionId: casterSessionId,
      shardId: "prime_shard",
      roomId: "prime_shard:0,0",
      hp: 9,
      maxHp: 50,
      alive: true,
      tags: [],
    };

    const allyEntity = {
      id: "ent_ally",
      type: "player",
      name: "Ally",
      ownerSessionId: allySessionId,
      shardId: "prime_shard",
      roomId: "prime_shard:0,0",
      hp: 10,
      maxHp: 40,
      alive: true,
      tags: [],
    };

    const spell: SpellDefinition = {
      id: "test_hot_single_ally",
      name: "Test Regen Ally",
      kind: "heal_hot_single_ally",
      description: "test",
      classId: "cleric",
      minLevel: 1,
      resourceType: "mana",
      resourceCost: 0,
      cooldownMs: 0,
      statusEffect: {
        id: "se_regen_ally",
        name: "Regeneration",
        durationMs: 10_000,
        modifiers: {},
        tags: ["hot"],
        hot: { tickIntervalMs: 2000, perTickHeal: 6 },
      },
    };

    caster.spellbook.spells.push({ spellId: spell.id, minLevel: 1 });

    const ctx = makeCtx({
      casterSessionId,
      casterEntity,
      casterChar: caster,
      allySessionId,
      allyEntity,
      allyChar: ally,
    });

    const msg = await castSpellForCharacter(ctx, caster, spell, "Ally");
    assert.ok(msg.includes("regeneration") || msg.includes("Regeneration") || msg.includes("weave"), msg);

    // Tick 1 at +2000
    tickStatusEffectsAndApplyHots(ally, 2_002_000, (amt) => {
      allyEntity.hp = Math.min(allyEntity.maxHp, allyEntity.hp + amt);
    });
    assert.equal(allyEntity.hp, 16, "ally healed by HOT tick 1");
    assert.equal(casterEntity.hp, 9, "caster should not be healed by ally HOT");

    // Tick 2 at +4000
    tickStatusEffectsAndApplyHots(ally, 2_004_000, (amt) => {
      allyEntity.hp = Math.min(allyEntity.maxHp, allyEntity.hp + amt);
    });
    assert.equal(allyEntity.hp, 22, "ally healed by HOT tick 2");
    assert.equal(casterEntity.hp, 9, "caster should still not be healed");
  } finally {
    Date.now = realNow;
  }
});
