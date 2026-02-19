//worldcore/test/contract_shieldPriority_respectsDamageSchoolFilter.test.ts
//
// Contract: Absorb shield `priority` MUST NOT override `absorb.schools` filtering.
// A higher-priority shield that does not match the incoming DamageSchool must be ignored.
//
// Scenario:
//  - Older, low-priority physical shield (no school restriction)
//  - Newer, high-priority fire-only shield (schools: ["fire"])
//  - Physical hit should consume ONLY the physical shield
//  - Fire hit should consume the fire-only shield first

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

test("[contract] shield priority respects damage school filtering", async () => {
  const realNow = Date.now;
  Date.now = () => 6_000_000;
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

    const grpPhys = "grp_shield_phys";
    const grpFire = "grp_shield_fire";

    const physShield: SpellDefinition = {
      id: "test_shield_phys",
      name: "Physical Shield",
      kind: "shield_self",
      description: "test",
      classId: "cleric",
      minLevel: 1,
      resourceType: "mana",
      resourceCost: 0,
      cooldownMs: 0,
      statusEffect: {
        id: "se_shield_phys",
        name: "Phys",
        stackingGroupId: grpPhys,
        stackingPolicy: "overwrite",
        durationMs: 10_000,
        modifiers: {},
        tags: ["shield"],
        // No school restriction; low priority.
        absorb: { amount: 6, priority: 0 },
      },
    };

    const fireOnlyShield: SpellDefinition = {
      id: "test_shield_fire",
      name: "Fire Ward",
      kind: "shield_self",
      description: "test",
      classId: "cleric",
      minLevel: 1,
      resourceType: "mana",
      resourceCost: 0,
      cooldownMs: 0,
      statusEffect: {
        id: "se_shield_fire",
        name: "Fire",
        stackingGroupId: grpFire,
        stackingPolicy: "overwrite",
        durationMs: 10_000,
        modifiers: {},
        tags: ["shield"],
        // Fire-only; HIGH priority.
        absorb: { amount: 5, schools: ["fire"], priority: 10 },
      },
    };

    char.spellbook.spells.push({ spellId: physShield.id, minLevel: 1 });
    char.spellbook.spells.push({ spellId: fireOnlyShield.id, minLevel: 1 });
    const ctx = makeCtx(selfSessionId, selfEntity);

    // Apply physical shield first (older)
    await castSpellForCharacter(ctx, char, physShield, "");
    // Apply fire shield later (newer)
    Date.now = () => 6_001_000;
    await castSpellForCharacter(ctx, char, fireOnlyShield, "");

    // 1) Physical hit: should IGNORE fire-only shield even though it is higher priority.
    applySimpleDamageToPlayer(selfEntity, 4, char, "physical", { ignoreServiceProtection: true });
    assert.equal(selfEntity.hp, 50, "physical hit should be fully absorbed by phys shield");

    let active = (char as any).progression?.statusEffects?.active ?? {};
    assert.ok(Object.prototype.hasOwnProperty.call(active, grpFire), "fire-only shield should remain after physical hit");
    assert.ok(Object.prototype.hasOwnProperty.call(active, grpPhys), "physical shield should remain after partial absorb");
    const physInst = (Array.isArray(active[grpPhys]) ? active[grpPhys][0] : active[grpPhys]) ?? null;
    const fireInst = (Array.isArray(active[grpFire]) ? active[grpFire][0] : active[grpFire]) ?? null;
    assert.ok(physInst && fireInst, "expected both shield instances");
    assert.equal(physInst.absorb?.remaining, 2, "expected physical shield remaining after physical hit");
    assert.equal(fireInst.absorb?.remaining, 5, "expected fire-only shield unchanged by physical hit");

    // 2) Fire hit: should consume fire-only shield first (priority + school match), then remaining from phys.
    applySimpleDamageToPlayer(selfEntity, 7, char, "fire", { ignoreServiceProtection: true });
    assert.equal(selfEntity.hp, 50, "fire hit should be fully absorbed");

    active = (char as any).progression?.statusEffects?.active ?? {};
    // Fire shield was 5, should be depleted and removed.
    assert.ok(
      !Object.prototype.hasOwnProperty.call(active, grpFire),
      "expected fire-only shield bucket removed when depleted by matching fire damage",
    );
    // Phys shield had 2 remaining, should be depleted by the extra 2.
    assert.ok(
      !Object.prototype.hasOwnProperty.call(active, grpPhys),
      "expected physical shield bucket removed after remaining absorb consumed",
    );
  } finally {
    Date.now = realNow;
  }
});
