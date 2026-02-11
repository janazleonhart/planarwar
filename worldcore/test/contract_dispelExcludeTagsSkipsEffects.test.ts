// worldcore/test/contract_dispelExcludeTagsSkipsEffects.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import type { SpellDefinition } from "../spells/SpellTypes";
import { castSpellForCharacter } from "../mud/MudSpells";
import { applyStatusEffectToEntity, computeEntityCombatStatusSnapshot } from "../combat/StatusEffects";

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

function makeCtx(selfSessionId: string, selfEntity: any, entitiesList: any[]) {
  return {
    nowMs: 5_100_000,
    session: { id: selfSessionId, shardId: "prime_shard", roomId: "prime_shard:0,0" },
    entities: {
      getEntityByOwner: (ownerSessionId: string) => (ownerSessionId === selfSessionId ? selfEntity : null),
      getAll: () => entitiesList,
    },
    items: {
      getEquipped: () => [],
    },
  } as any;
}

test("[contract] dispel excludeTags skips otherwise-matching effects", async () => {
  const realNow = Date.now;
  Date.now = () => 5_100_000;
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

    const npc = {
      id: "ent_dummy",
      type: "npc",
      name: "Training Dummy",
      shardId: "prime_shard",
      roomId: "prime_shard:0,0",
      hp: 100,
      maxHp: 100,
      alive: true,
      tags: [],
    };

    // Two buffs: one minor, one major.
    applyStatusEffectToEntity(npc as any, {
      id: "se_buff_minor",
      sourceKind: "spell",
      sourceId: "buff_minor",
      name: "Minor Might",
      durationMs: 10_000,
      maxStacks: 1,
      initialStacks: 1,
      modifiers: { damageDealtPct: 0.1 },
      tags: ["buff", "minor"],
    });

    applyStatusEffectToEntity(npc as any, {
      id: "se_buff_major",
      sourceKind: "spell",
      sourceId: "buff_major",
      name: "Major Might",
      durationMs: 10_000,
      maxStacks: 1,
      initialStacks: 1,
      modifiers: { damageDealtPct: 0.3 },
      tags: ["buff", "major"],
    });

    const before = computeEntityCombatStatusSnapshot(npc as any);
    assert.equal(before.damageDealtPct, 0.4);

    const spell: SpellDefinition = {
      id: "test_dispel_single_npc_exclude_minor",
      name: "Test Dispel",
      kind: "dispel_single_npc",
      description: "test",
      classId: "cleric",
      minLevel: 1,
      resourceType: "mana",
      resourceCost: 0,
      cooldownMs: 0,
      dispel: { tags: ["buff"], maxToRemove: 10, excludeTags: ["minor"] },
    };

    char.spellbook.spells.push({ spellId: spell.id, minLevel: 1 });
    const ctx = makeCtx(selfSessionId, selfEntity, [selfEntity, npc]);

    const msg = await castSpellForCharacter(ctx, char, spell, "Training Dummy");
    assert.ok(msg.includes("dispel") || msg.includes("Nothing"), msg);

    const after = computeEntityCombatStatusSnapshot(npc as any);
    // Major removed; minor protected by excludeTags.
    assert.equal(after.damageDealtPct, 0.1);
  } finally {
    Date.now = realNow;
  }
});
