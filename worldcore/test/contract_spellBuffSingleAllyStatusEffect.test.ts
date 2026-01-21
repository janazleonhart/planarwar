import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import type { SpellDefinition } from "../spells/SpellTypes";
import { castSpellForCharacter } from "../mud/MudSpells";
import { computeCombatStatusSnapshot } from "../combat/StatusEffects";

function makeChar(id: string, name: string): CharacterState {
  return {
    id,
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

test("[contract] buff_single_ally applies its status effect to the targeted ally", async () => {
  const realNow = Date.now;
  Date.now = () => 2_000_000;
  try {
    const caster = makeChar("char_caster", "Caster");
    const ally = makeChar("char_ally", "Ally");

    const casterSessionId = "sess_caster";
    const allySessionId = "sess_ally";

    const casterEntity = {
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

    const allyEntity = {
      id: "ent_ally",
      type: "player",
      name: "Ally",
      ownerSessionId: allySessionId,
      shardId: "prime_shard",
      roomId: "prime_shard:0,0",
      hp: 30,
      maxHp: 30,
      alive: true,
      tags: [],
    };

    const spell: SpellDefinition = {
      id: "test_buff_ally",
      name: "Test Blessing",
      kind: "buff_single_ally",
      description: "test",
      classId: "mage",
      minLevel: 1,
      resourceType: "mana",
      resourceCost: 0,
      cooldownMs: 0,
      statusEffect: {
        id: "se_bless",
        name: "Blessed",
        durationMs: 10_000,
        modifiers: { damageTakenPct: -0.25 },
      },
    };

    caster.spellbook.spells.push({ spellId: spell.id, minLevel: 1 });

    const sessionsById = new Map<string, any>([
      [casterSessionId, { id: casterSessionId, character: caster }],
      [allySessionId, { id: allySessionId, character: ally }],
    ]);

    const ctx = {
      session: { id: casterSessionId, shardId: "prime_shard", roomId: "prime_shard:0,0" },
      sessions: {
        getAllSessions: () => [...sessionsById.values()],
        get: (id: string) => sessionsById.get(id),
      },
      entities: {
        getEntityByOwner: (ownerSessionId: string) => {
          if (ownerSessionId === casterSessionId) return casterEntity;
          if (ownerSessionId === allySessionId) return allyEntity;
          return null;
        },
      },
      items: {
        getEquipped: () => [],
      },
    } as any;

    const msg = await castSpellForCharacter(ctx, caster, spell, "Ally");
    assert.ok(msg.includes("Blessed") || msg.includes("Blessing"), msg);

    const casterSnap = computeCombatStatusSnapshot(caster);
    const allySnap = computeCombatStatusSnapshot(ally);

    assert.equal(casterSnap.damageTakenPct, 0);
    assert.equal(allySnap.damageTakenPct, -0.25);
  } finally {
    Date.now = realNow;
  }
});
