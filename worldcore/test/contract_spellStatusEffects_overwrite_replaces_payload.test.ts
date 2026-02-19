//worldcore/test/contract_spellStatusEffects_overwrite_replaces_payload.test.ts

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

function makeCtx(selfSessionId: string, selfEntity: any, nowMs: number) {
  return {
    nowMs,
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

test("[contract] overwrite stackingPolicy replaces modifiers in a shared stackingGroupId bucket (rank upgrade)", async () => {
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

  const group = "grp_ranked_buff";

  const rank1: SpellDefinition = {
    id: "test_ranked_buff_i",
    name: "Test Ranked Buff I",
    kind: "buff_self",
    description: "test",
    classId: "mage",
    minLevel: 1,
    resourceType: "mana",
    resourceCost: 0,
    cooldownMs: 0,
    statusEffect: {
      id: "se_ranked_buff",
      stackingGroupId: group,
      stackingPolicy: "overwrite",
      durationMs: 10_000,
      modifiers: { damageDealtPct: 0.1 },
    },
  };

  const rank2: SpellDefinition = {
    id: "test_ranked_buff_ii",
    name: "Test Ranked Buff II",
    kind: "buff_self",
    description: "test",
    classId: "mage",
    minLevel: 1,
    resourceType: "mana",
    resourceCost: 0,
    cooldownMs: 0,
    statusEffect: {
      id: "se_ranked_buff",
      stackingGroupId: group,
      stackingPolicy: "overwrite",
      durationMs: 10_000,
      modifiers: { damageDealtPct: 0.3 },
    },
  };

  char.spellbook.spells.push({ spellId: rank1.id, minLevel: 1 });
  char.spellbook.spells.push({ spellId: rank2.id, minLevel: 1 });

  await castSpellForCharacter(makeCtx(selfSessionId, selfEntity, 1_000_000), char, rank1, "");
  const snap1 = computeCombatStatusSnapshot(char, 1_000_000);
  assert.equal(snap1.damageDealtPct, 0.1);

  await castSpellForCharacter(makeCtx(selfSessionId, selfEntity, 1_001_000), char, rank2, "");
  const snap2 = computeCombatStatusSnapshot(char, 1_001_000);
  assert.equal(snap2.damageDealtPct, 0.3, "expected overwrite to replace payload (rank upgrade)");

  const active = (char as any)?.progression?.statusEffects?.active ?? {};
  assert.ok(Object.prototype.hasOwnProperty.call(active, group), "expected stackingGroupId bucket to exist");

  // Ensure we did not create multiple buckets for the same ranked effect.
  const keys = Object.keys(active);
  assert.equal(keys.filter((k) => k === group).length, 1);
});
