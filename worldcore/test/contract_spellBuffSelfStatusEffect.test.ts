import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import type { SpellDefinition } from "../spells/SpellTypes";
import { castSpellForCharacter } from "../mud/MudSpells";
import { computeCombatStatusSnapshot } from "../combat/StatusEffects";

function makeChar(name: string): CharacterState {
  return {
    id: "char_" + name.toLowerCase(),
    name,
    level: 1,
    classId: "mage",
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

test("[contract] buff_self applies its status effect to the caster", async () => {
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
      hp: 50,
      maxHp: 50,
      alive: true,
      tags: [],
    };

    const spell: SpellDefinition = {
      id: "test_buff_self",
      name: "Test Inspire",
      kind: "buff_self",
      description: "test",
      classId: "mage",
      minLevel: 1,
      resourceType: "mana",
      resourceCost: 0,
      cooldownMs: 0,
      statusEffect: {
        id: "se_inspire",
        name: "Inspired",
        durationMs: 10_000,
        modifiers: { damageDealtPct: 0.5 },
      },
    };

    char.spellbook.spells.push({ spellId: spell.id, minLevel: 1 });

    const ctx = makeCtx(selfSessionId, selfEntity);

    const msg = await castSpellForCharacter(ctx, char, spell, "");
    assert.ok(msg.includes("Inspired") || msg.includes("Inspire"), msg);

    const snap = computeCombatStatusSnapshot(char);
    assert.equal(snap.damageDealtPct, 0.5);
  } finally {
    Date.now = realNow;
  }
});
