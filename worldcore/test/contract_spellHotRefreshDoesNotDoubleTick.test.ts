// worldcore/test/contract_spellHotRefreshDoesNotDoubleTick.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import type { SpellDefinition } from "../spells/SpellTypes";
import { castSpellForCharacter } from "../mud/MudSpells";
import { tickStatusEffectsAndApplyHots } from "../combat/StatusEffects";

function makeChar(name: string): CharacterState {
  return {
    id: `char_${name.toLowerCase()}`,
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

function makeCtx(opts: {
  casterSessionId: string;
  casterEntity: any;
  casterChar: CharacterState;
  allySessionId: string;
  allyEntity: any;
  allyChar: CharacterState;
}) {
  const { casterSessionId, casterEntity, casterChar, allySessionId, allyEntity, allyChar } = opts;

  const casterSession = { id: casterSessionId, shardId: "prime_shard", roomId: "prime_shard:0,0", character: casterChar };
  const allySession = { id: allySessionId, shardId: "prime_shard", roomId: "prime_shard:0,0", character: allyChar };

  return {
    session: casterSession,
    sessions: { getAllSessions: () => [casterSession, allySession] },
    entities: {
      getEntityByOwner: (ownerSessionId: string) => {
        if (ownerSessionId === casterSessionId) return casterEntity;
        if (ownerSessionId === allySessionId) return allyEntity;
        return null;
      },
    },
    items: { getEquipped: () => [] },
  } as any;
}

function bucketLen(bucket: any): number {
  if (!bucket) return 0;
  return Array.isArray(bucket) ? bucket.length : 1;
}
function bucketFirst(bucket: any): any {
  if (!bucket) return null;
  return Array.isArray(bucket) ? bucket[0] : bucket;
}

test("[contract] HOT recast refreshes duration without double-ticking (cadence never earlier)", async () => {
  const realNow = Date.now;
  let fakeNow = 2_000_000;
  Date.now = () => fakeNow;

  try {
    const caster = makeChar("Caster");
    const ally = makeChar("Ally");

    const casterSessionId = "sess_caster";
    const allySessionId = "sess_ally";

    const casterEntity = {
      id: "ent_caster",
      type: "player",
      name: "Caster",
      ownerSessionId: casterSessionId,
      shardId: "prime_shard",
      roomId: "prime_shard:0,0",
      hp: 9,
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
      hp: 10,
      maxHp: 40,
      alive: true,
      tags: [],
    };

    const spell: SpellDefinition = {
      id: "test_hot_refresh_ally",
      name: "Test Regen Ally",
      kind: "heal_hot_single_ally",
      description: "test",
      classId: "cleric",
      minLevel: 1,
      resourceType: "mana",
      resourceCost: 0,
      cooldownMs: 0,
      statusEffect: {
        id: "se_regen_ally",
        name: "Regeneration",
        durationMs: 10_000,
        modifiers: {},
        tags: ["hot"],
        hot: { tickIntervalMs: 2000, perTickHeal: 6 },
      },
    };

    caster.spellbook.spells.push({ spellId: spell.id, minLevel: 1 });

    const ctx = makeCtx({
      casterSessionId,
      casterEntity,
      casterChar: caster,
      allySessionId,
      allyEntity,
      allyChar: ally,
    });

    // First cast at t=2,000,000
    fakeNow = 2_000_000;
    await castSpellForCharacter(ctx, caster, spell, "Ally");

    // Tick 1 at +2000
    tickStatusEffectsAndApplyHots(ally, 2_002_000, (amt) => {
      allyEntity.hp = Math.min(allyEntity.maxHp, allyEntity.hp + amt);
    });
    assert.equal(allyEntity.hp, 16, "ally healed by HOT tick 1");

    // Capture next tick time after tick 1
    const active1 = (ally as any).progression?.statusEffects?.active ?? {};
    const bucket1 = active1["se_regen_ally"];
    assert.equal(bucketLen(bucket1), 1, "expected exactly one HOT instance after first cast");
    const instBefore = bucketFirst(bucket1);
    assert.ok(instBefore?.hot, "expected HOT instance to have hot payload");
    const nextBefore: number = instBefore.hot.nextTickAtMs;

    // Recast at +2500
    fakeNow = 2_002_500;
    await castSpellForCharacter(ctx, caster, spell, "Ally");

    // No immediate tick at same moment
    tickStatusEffectsAndApplyHots(ally, 2_002_500, (amt) => {
      allyEntity.hp = Math.min(allyEntity.maxHp, allyEntity.hp + amt);
    });
    assert.equal(allyEntity.hp, 16, "recast should not double-tick immediately");

    const active2 = (ally as any).progression?.statusEffects?.active ?? {};
    const bucket2 = active2["se_regen_ally"];
    assert.equal(bucketLen(bucket2), 1, "HOT recast should not create a second active instance");
    const instAfter = bucketFirst(bucket2);

    // Expiry should refresh to recast time + duration
    assert.equal(instAfter.expiresAtMs, 2_012_500, "recast should extend expiry to later timestamp");

    const nextAfter: number = instAfter.hot?.nextTickAtMs;
    assert.ok(Number.isFinite(nextAfter), "expected nextTickAtMs after recast");

    // Cadence safety invariants (prevents pull-forward/double-tick abuse)
    assert.ok(nextAfter >= 2_004_500, "next tick should not occur earlier than recast+interval");
    assert.ok(nextAfter >= nextBefore, "recast should not pull next tick earlier than pre-recast schedule");

    // No tick right before scheduled next tick
    tickStatusEffectsAndApplyHots(ally, nextAfter - 1, (amt) => {
      allyEntity.hp = Math.min(allyEntity.maxHp, allyEntity.hp + amt);
    });
    assert.equal(allyEntity.hp, 16, "no tick just before nextTickAtMs");

    // Tick exactly at nextTickAtMs
    tickStatusEffectsAndApplyHots(ally, nextAfter, (amt) => {
      allyEntity.hp = Math.min(allyEntity.maxHp, allyEntity.hp + amt);
    });
    assert.equal(allyEntity.hp, 22, "tick occurs exactly at nextTickAtMs after recast");
  } finally {
    Date.now = realNow;
  }
});
