//worldcore/test/contract_spellShieldRankOverwriteResetsRemaining.test.ts

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

test("[contract] shield ranks overwrite within stackingGroupId bucket and reset remaining (rank upgrade)", async () => {
  const realNow = Date.now;
  Date.now = () => 3_000_000;
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

    const group = "grp_ranked_shield";

    const shield1: SpellDefinition = {
      id: "test_ranked_shield_i",
      name: "Test Shield I",
      kind: "shield_self",
      description: "test",
      classId: "cleric",
      minLevel: 1,
      resourceType: "mana",
      resourceCost: 0,
      cooldownMs: 0,
      statusEffect: {
        id: "se_ranked_ward",
        name: "Ranked Ward",
        stackingGroupId: group,
        stackingPolicy: "overwrite",
        durationMs: 10_000,
        modifiers: {},
        tags: ["shield"],
        absorb: { amount: 10 },
      },
    };

    const shield2: SpellDefinition = {
      id: "test_ranked_shield_ii",
      name: "Test Shield II",
      kind: "shield_self",
      description: "test",
      classId: "cleric",
      minLevel: 1,
      resourceType: "mana",
      resourceCost: 0,
      cooldownMs: 0,
      statusEffect: {
        id: "se_ranked_ward",
        name: "Ranked Ward",
        stackingGroupId: group,
        stackingPolicy: "overwrite",
        durationMs: 10_000,
        modifiers: {},
        tags: ["shield"],
        absorb: { amount: 25 },
      },
    };

    // Allow casting the ad-hoc spells in test harness.
    char.spellbook.spells.push({ spellId: shield1.id, minLevel: 1 });
    char.spellbook.spells.push({ spellId: shield2.id, minLevel: 1 });
    const ctx = makeCtx(selfSessionId, selfEntity);

    await castSpellForCharacter(ctx, char, shield1, "");

    // Consume part of the Rank I shield.
    applySimpleDamageToPlayer(selfEntity, 7, char, "physical", { ignoreServiceProtection: true });
    assert.equal(selfEntity.hp, 50, "damage should be absorbed");

    const active1 = (char as any).progression?.statusEffects?.active ?? {};
    assert.ok(Object.prototype.hasOwnProperty.call(active1, group), "expected stackingGroupId bucket key");
    const inst1 = (Array.isArray(active1[group]) ? active1[group][0] : active1[group]) ?? null;
    assert.ok(inst1, "expected shield instance in bucket");
    assert.equal(inst1?.sourceId, shield1.id, "expected Rank I to be the active sourceId");
    assert.equal(inst1?.absorb?.remaining, 3, "expected remaining shield after 7 absorbed");

    // Rank upgrade should overwrite and reset remaining (no carryover).
    Date.now = () => 3_001_000;
    await castSpellForCharacter(ctx, char, shield2, "");

    const active2 = (char as any).progression?.statusEffects?.active ?? {};
    const bucket = active2[group];
    const list = Array.isArray(bucket) ? bucket : [bucket];
    assert.equal(list.length, 1, "expected exactly one instance in stackingGroupId bucket");

    const inst2 = list[0];
    assert.equal(inst2?.sourceId, shield2.id, "expected Rank II to overwrite sourceId");
    assert.equal(inst2?.absorb?.remaining, 25, "expected overwrite to reset remaining to new amount");
  } finally {
    Date.now = realNow;
  }
});
