//worldcore/test/contract_spellStatusEffects_overwrite_replaces_hot_payload.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import type { SpellDefinition } from "../spells/SpellTypes";
import { castSpellForCharacter } from "../mud/MudSpells";
import { getActiveStatusEffects } from "../combat/StatusEffects";

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

/**
 * Contract: stackingPolicy "overwrite" replaces HOT payload (perTickHeal, tickInterval)
 * and resets tick scheduling under a shared stackingGroupId (rank upgrade).
 */
test("[contract] overwrite stackingPolicy replaces HOT payload and resets tick schedule (rank upgrade)", async () => {
  const caster = makeChar("Caster");
  const target = makeChar("Target");

  const casterSessionId = "sess_caster";
  const targetSessionId = "sess_target";

  const casterEnt = {
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
  };

  const targetEnt = {
    id: "ent_target",
    type: "player",
    name: "Target",
    ownerSessionId: targetSessionId,
    shardId: "prime_shard",
    roomId: "prime_shard:0,0",
    hp: 10,
    maxHp: 50,
    alive: true,
    tags: [],
  };

  const group = "grp_ranked_hot";

  const hot1: SpellDefinition = {
    id: "test_ranked_hot_i",
    name: "Test Ranked HoT I",
    kind: "heal_hot_single_ally",
    description: "test",
    classId: "mage",
    minLevel: 1,
    resourceType: "mana",
    resourceCost: 0,
    cooldownMs: 0,
    statusEffect: {
      id: "se_ranked_hot",
      name: "Test Ranked HoT",
      stackingGroupId: group,
      stackingPolicy: "overwrite",
      durationMs: 10_000,
      modifiers: {},
      hot: {
        perTickHeal: 5,
        tickIntervalMs: 1000,
      },
    },
  };

  const hot2: SpellDefinition = {
    id: "test_ranked_hot_ii",
    name: "Test Ranked HoT II",
    kind: "heal_hot_single_ally",
    description: "test",
    classId: "mage",
    minLevel: 1,
    resourceType: "mana",
    resourceCost: 0,
    cooldownMs: 0,
    statusEffect: {
      id: "se_ranked_hot",
      name: "Test Ranked HoT",
      stackingGroupId: group,
      stackingPolicy: "overwrite",
      durationMs: 10_000,
      modifiers: {},
      hot: {
        perTickHeal: 12,
        tickIntervalMs: 700,
      },
    },
  };

  // Put the spells in the spellbook so casting gates won't deny.
  caster.spellbook.spells.push({ spellId: hot1.id, minLevel: 1 });
  caster.spellbook.spells.push({ spellId: hot2.id, minLevel: 1 });

  const mkCtx = (nowMs: number) =>
    ({
      nowMs,
      session: { id: casterSessionId, shardId: "prime_shard", roomId: "prime_shard:0,0" },
      sessions: {
        getAllSessions: () => [
          { id: casterSessionId, roomId: "prime_shard:0,0", character: caster },
          { id: targetSessionId, roomId: "prime_shard:0,0", character: target },
        ],
      },
      entities: {
        getEntityByOwner: (ownerSessionId: string) => {
          if (ownerSessionId === casterSessionId) return casterEnt;
          if (ownerSessionId === targetSessionId) return targetEnt;
          return null;
        },
        // Some spell handlers use this form.
        getEntityById: (id: string) => {
          if (id === casterEnt.id) return casterEnt;
          if (id === targetEnt.id) return targetEnt;
          return null;
        },
      },
      items: {
        getEquipped: () => [],
      },
    }) as any;

  // Cast Rank I.
  const now1 = 1_000_000;
  await castSpellForCharacter(mkCtx(now1), caster, hot1 as SpellDefinition as SpellDefinition, "Target");

  const effects1 = getActiveStatusEffects(target, now1);
  const inst1 = effects1.find((e) => e && e.stackingGroupId === group) ?? null;
  assert.ok(inst1, "expected stackingGroupId instance to exist on target");
  assert.ok(inst1.hot, "expected HOT payload to exist");
  assert.equal(inst1.hot?.perTickHeal, 5);
  assert.equal(inst1.hot?.tickIntervalMs, 1000);
  assert.equal(inst1.hot?.nextTickAtMs, now1 + 1000);

  // Upgrade (Rank II) later.
  const now2 = 1_001_000;
  await castSpellForCharacter(mkCtx(now2), caster, hot2 as SpellDefinition as SpellDefinition, "Target");

  const effects2 = getActiveStatusEffects(target, now2);
  const inst2 = effects2.find((e) => e && e.stackingGroupId === group) ?? null;
  assert.ok(inst2, "expected stackingGroupId instance to exist after overwrite");
  assert.ok(inst2.hot, "expected HOT payload to exist after overwrite");

  assert.equal(inst2.hot?.perTickHeal, 12, "expected overwrite to replace perTickHeal");
  assert.equal(inst2.hot?.tickIntervalMs, 700, "expected overwrite to replace tickIntervalMs");
  assert.equal(inst2.hot?.nextTickAtMs, now2 + 700, "expected overwrite to reset nextTickAtMs based on new interval");

  // Ensure we did not create multiple instances in the same bucket.
  const bucketed = effects2.filter((e) => e && e.stackingGroupId === group);
  assert.equal(bucketed.length, 1, "expected exactly one instance for the stackingGroupId bucket");
});
