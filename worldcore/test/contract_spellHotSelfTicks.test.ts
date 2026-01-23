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

test("[contract] heal_hot_self applies a HOT status and ticks healing deterministically", async () => {
  const realNow = Date.now;
  Date.now = () => 1_000_000;
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
      hp: 10,
      maxHp: 50,
      alive: true,
      tags: [],
    };

    const spell: SpellDefinition = {
      id: "test_hot_self",
      name: "Test Regeneration",
      kind: "heal_hot_self",
      description: "test",
      classId: "cleric",
      minLevel: 1,
      resourceType: "mana",
      resourceCost: 0,
      cooldownMs: 0,
      statusEffect: {
        id: "se_regen",
        name: "Regeneration",
        durationMs: 10_000,
        modifiers: {},
        tags: ["hot"],
        hot: { tickIntervalMs: 2000, perTickHeal: 7 },
      },
    };

    char.spellbook.spells.push({ spellId: spell.id, minLevel: 1 });

    const ctx = makeCtx(selfSessionId, selfEntity);

    const msg = await castSpellForCharacter(ctx, char, spell, "");
    assert.ok(msg.includes("regenerating") || msg.includes("Regeneration"), msg);

    // First tick @ t=+2000
    tickStatusEffectsAndApplyHots(char, 1_002_000, (amt) => {
      selfEntity.hp = Math.min(selfEntity.maxHp, selfEntity.hp + amt);
    });
    assert.equal(selfEntity.hp, 17);

    // Second tick @ t=+4000
    tickStatusEffectsAndApplyHots(char, 1_004_000, (amt) => {
      selfEntity.hp = Math.min(selfEntity.maxHp, selfEntity.hp + amt);
    });
    assert.equal(selfEntity.hp, 24);
  } finally {
    Date.now = realNow;
  }
});
