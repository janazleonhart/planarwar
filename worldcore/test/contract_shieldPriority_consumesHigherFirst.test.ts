//worldcore/test/contract_shieldPriority_consumesHigherFirst.test.ts
//
// Contract: Absorb shields may optionally specify `absorb.priority`.
// Higher priority shields are consumed before lower priority shields,
// regardless of application time. Ties fall back to oldest-first.

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

test("[contract] shield absorb priority consumes higher priority before older shields", async () => {
  const realNow = Date.now;
  Date.now = () => 5_000_000;
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

    const grpLow = "grp_shield_lowprio";
    const grpHigh = "grp_shield_highprio";

    const lowPrio: SpellDefinition = {
      id: "test_shield_lowprio",
      name: "Low Prio Shield",
      kind: "shield_self",
      description: "test",
      classId: "cleric",
      minLevel: 1,
      resourceType: "mana",
      resourceCost: 0,
      cooldownMs: 0,
      statusEffect: {
        id: "se_shield_lowprio",
        name: "Low Prio",
        stackingGroupId: grpLow,
        stackingPolicy: "overwrite",
        durationMs: 10_000,
        modifiers: {},
        tags: ["shield"],
        absorb: { amount: 7, priority: 0 },
      },
    };

    const highPrio: SpellDefinition = {
      id: "test_shield_highprio",
      name: "High Prio Shield",
      kind: "shield_self",
      description: "test",
      classId: "cleric",
      minLevel: 1,
      resourceType: "mana",
      resourceCost: 0,
      cooldownMs: 0,
      statusEffect: {
        id: "se_shield_highprio",
        name: "High Prio",
        stackingGroupId: grpHigh,
        stackingPolicy: "overwrite",
        durationMs: 10_000,
        modifiers: {},
        tags: ["shield"],
        absorb: { amount: 5, priority: 10 },
      },
    };

    char.spellbook.spells.push({ spellId: lowPrio.id, minLevel: 1 });
    char.spellbook.spells.push({ spellId: highPrio.id, minLevel: 1 });
    const ctx = makeCtx(selfSessionId, selfEntity);

    // Apply the LOW priority shield first (older).
    await castSpellForCharacter(ctx, char, lowPrio, "");

    // Apply the HIGH priority shield later (newer).
    Date.now = () => 5_001_000;
    await castSpellForCharacter(ctx, char, highPrio, "");

    // Deal 6 damage: should consume HIGH first (5), then 1 from LOW.
    applySimpleDamageToPlayer(selfEntity, 6, char, "physical", { ignoreServiceProtection: true });
    assert.equal(selfEntity.hp, 50, "damage should be fully absorbed");

    const active = (char as any).progression?.statusEffects?.active ?? {};

    // High should be depleted and removed.
    assert.ok(
      !Object.prototype.hasOwnProperty.call(active, grpHigh),
      "expected high-priority shield bucket to be removed when depleted",
    );

    // Low should remain with 6 remaining (7 - 1).
    assert.ok(Object.prototype.hasOwnProperty.call(active, grpLow), "expected low-priority shield bucket to exist");
    const bucketLow = active[grpLow];
    const instLow = (Array.isArray(bucketLow) ? bucketLow[0] : bucketLow) ?? null;
    assert.ok(instLow, "expected low-priority shield instance");
    assert.equal(instLow?.absorb?.remaining, 6, "expected low-priority shield remaining after priority consumption");
  } finally {
    Date.now = realNow;
  }
});
