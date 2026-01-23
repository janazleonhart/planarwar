import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import type { SpellDefinition } from "../spells/SpellTypes";
import { castSpellForCharacter } from "../mud/MudSpells";
import { applySimpleDamageToPlayer } from "../combat/entityCombat";

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

test("[contract] shield_self absorbs incoming player damage (can reduce to 0)", async () => {
  const realNow = Date.now;
  Date.now = () => 2_000_000;
  try {
    const char = makeChar("Caster");
    const selfSessionId = "sess_caster";

    const selfEntity: any = {
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
      id: "test_shield_self",
      name: "Test Ward",
      kind: "shield_self",
      description: "test",
      classId: "cleric",
      minLevel: 1,
      resourceType: "mana",
      resourceCost: 0,
      cooldownMs: 0,
      statusEffect: {
        id: "se_ward",
        name: "Ward",
        durationMs: 10_000,
        modifiers: {},
        tags: ["shield"],
        absorb: { amount: 10 },
      },
    };

    char.spellbook.spells.push({ spellId: spell.id, minLevel: 1 });
    const ctx = makeCtx(selfSessionId, selfEntity);

    const msg = await castSpellForCharacter(ctx, char, spell, "");
    assert.ok(msg.includes("ward") || msg.includes("Ward"), msg);

    // Hit for 8: fully absorbed (hp unchanged)
    applySimpleDamageToPlayer(selfEntity, 8, char, "physical", { ignoreServiceProtection: true });
    assert.equal(selfEntity.hp, 50);

    // Hit for 5: remaining shield is 2, so 3 goes through.
    applySimpleDamageToPlayer(selfEntity, 5, char, "physical", { ignoreServiceProtection: true });
    assert.equal(selfEntity.hp, 47);

    const active = (char as any).progression?.statusEffects?.active ?? {};
    assert.equal(Object.keys(active).length, 0, "shield should be depleted and removed");
  } finally {
    Date.now = realNow;
  }
});
