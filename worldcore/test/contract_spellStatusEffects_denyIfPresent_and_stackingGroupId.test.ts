//worldcore/test/contract_spellStatusEffects_denyIfPresent_and_stackingGroupId.test.ts

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

test("[contract] deny_if_present blocks re-application of buff_self and returns stable blocked line", async () => {
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
    id: "test_lockout_buff",
    name: "Test Lockout Buff",
    kind: "buff_self",
    description: "test",
    classId: "mage",
    minLevel: 1,
    resourceType: "mana",
    resourceCost: 0,
    cooldownMs: 0,
    statusEffect: {
      id: "se_lockout",
      name: "Lockout",
      durationMs: 10_000,
      stackingPolicy: "deny_if_present",
      modifiers: { damageDealtPct: 0.1 },
    },
  };

  char.spellbook.spells.push({ spellId: spell.id, minLevel: 1 });

  const msg1 = await castSpellForCharacter(makeCtx(selfSessionId, selfEntity, 1_000_000), char, spell, "");
  assert.ok(msg1.includes("Lockout") || msg1.includes("gain"), msg1);

  const snap1 = computeCombatStatusSnapshot(char, 1_000_000);
  assert.equal(snap1.damageDealtPct, 0.1);

  const msg2 = await castSpellForCharacter(makeCtx(selfSessionId, selfEntity, 1_002_000), char, spell, "");
  assert.equal(msg2, "[world] [spell:Test Lockout Buff] That effect is already present.");

  const snap2 = computeCombatStatusSnapshot(char, 1_002_000);
  assert.equal(snap2.damageDealtPct, 0.1, "deny_if_present should not change snapshot");
});

test("[contract] buff_self respects stackingGroupId bucket key", async () => {
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
    id: "test_grouped_buff",
    name: "Test Grouped Buff",
    kind: "buff_self",
    description: "test",
    classId: "mage",
    minLevel: 1,
    resourceType: "mana",
    resourceCost: 0,
    cooldownMs: 0,
    statusEffect: {
      id: "se_grouped",
      stackingGroupId: "grp_grouped",
      durationMs: 10_000,
      modifiers: { damageDealtPct: 0.2 },
    },
  };

  char.spellbook.spells.push({ spellId: spell.id, minLevel: 1 });

  await castSpellForCharacter(makeCtx(selfSessionId, selfEntity, 1_000_000), char, spell, "");

  const active = (char as any)?.progression?.statusEffects?.active ?? {};
  assert.ok(Object.prototype.hasOwnProperty.call(active, "grp_grouped"), "expected statusEffects.active to use stackingGroupId bucket key");
});
