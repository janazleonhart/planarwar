//worldcore/test/contract_shieldFamiliesConsumeOldestFirst.test.ts

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

test("[contract] multiple shield families (different stackingGroupId) coexist and absorb consumes oldest-first", async () => {
  const realNow = Date.now;
  Date.now = () => 4_000_000;
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

    const groupA = "grp_shield_family_a";
    const groupB = "grp_shield_family_b";

    const shieldA: SpellDefinition = {
      id: "test_shield_family_a",
      name: "Test Shield A",
      kind: "shield_self",
      description: "test",
      classId: "cleric",
      minLevel: 1,
      resourceType: "mana",
      resourceCost: 0,
      cooldownMs: 0,
      statusEffect: {
        id: "se_shield_a",
        name: "Shield A",
        stackingGroupId: groupA,
        stackingPolicy: "overwrite",
        durationMs: 10_000,
        modifiers: {},
        tags: ["shield"],
        absorb: { amount: 5 },
      },
    };

    const shieldB: SpellDefinition = {
      id: "test_shield_family_b",
      name: "Test Shield B",
      kind: "shield_self",
      description: "test",
      classId: "cleric",
      minLevel: 1,
      resourceType: "mana",
      resourceCost: 0,
      cooldownMs: 0,
      statusEffect: {
        id: "se_shield_b",
        name: "Shield B",
        stackingGroupId: groupB,
        stackingPolicy: "overwrite",
        durationMs: 10_000,
        modifiers: {},
        tags: ["shield"],
        absorb: { amount: 7 },
      },
    };

    char.spellbook.spells.push({ spellId: shieldA.id, minLevel: 1 });
    char.spellbook.spells.push({ spellId: shieldB.id, minLevel: 1 });
    const ctx = makeCtx(selfSessionId, selfEntity);

    // Apply A first.
    await castSpellForCharacter(ctx, char, shieldA, "");

    // Apply B later so it is "newer".
    Date.now = () => 4_001_000;
    await castSpellForCharacter(ctx, char, shieldB, "");

    // Deal 6 damage: should consume A fully (5) then 1 from B.
    applySimpleDamageToPlayer(selfEntity, 6, char, "physical", { ignoreServiceProtection: true });
    assert.equal(selfEntity.hp, 50, "damage should be fully absorbed");

    const active = (char as any).progression?.statusEffects?.active ?? {};

    // A should be depleted and removed.
    assert.ok(
      !Object.prototype.hasOwnProperty.call(active, groupA),
      "expected Shield A bucket to be removed when depleted",
    );

    // B should remain with 6 remaining (7 - 1).
    assert.ok(Object.prototype.hasOwnProperty.call(active, groupB), "expected Shield B bucket to exist");
    const bucketB = active[groupB];
    const instB = (Array.isArray(bucketB) ? bucketB[0] : bucketB) ?? null;
    assert.ok(instB, "expected shield B instance");
    assert.equal(instB?.absorb?.remaining, 6, "expected Shield B remaining after oldest-first consumption");
  } finally {
    Date.now = realNow;
  }
});
