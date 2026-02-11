// worldcore/test/contract_mezBlocksHostileAndBreaksOnDamage.test.ts
//
// Contract:
// - "mez" blocks hostile actions before cost/cooldown.
// - Any meaningful damage breaks mez.

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import type { SpellDefinition } from "../spells/SpellTypes";
import { castSpellForCharacter } from "../mud/MudSpells";
import { applyStatusEffect, getActiveStatusEffects } from "../combat/StatusEffects";
import { applySimpleDamageToPlayer } from "../combat/entityCombat";

function makeChar(id: string, name: string): CharacterState {
  return {
    id,
    userId: "u",
    shardId: "prime_shard",
    name,
    classId: "archmage",
    level: 1,
    xp: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    lastRegionId: null,
    appearanceTag: null,
    attributes: { str: 1, agi: 1, int: 1, sta: 1, wis: 1, cha: 1 } as any,
    inventory: { bags: [], gold: 0 } as any,
    equipment: {} as any,
    spellbook: { known: {} } as any,
    abilities: {} as any,
    progression: {
      powerResources: { mana: { current: 50, max: 50 } },
      cooldowns: {},
      statusEffects: { active: {} },
    } as any,
    stateVersion: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  } as any;
}

class FakeEntities {
  private byOwner = new Map<string, any>();
  set(ownerSessionId: string, ent: any) {
    this.byOwner.set(ownerSessionId, ent);
  }
  getEntityByOwner(ownerSessionId: string) {
    return this.byOwner.get(ownerSessionId) ?? null;
  }
}

test("[contract] mez blocks hostile spells before cost/cooldown", async () => {
  const caster = makeChar("c1", "Caster");

  const now0 = 2_000_000;
  applyStatusEffect(
    caster,
    {
      id: "mez_contract_test",
      name: "Mesmerize",
      durationMs: 30_000,
      maxStacks: 1,
      stacks: 1,
      modifiers: {},
      tags: ["mez"],
      sourceKind: "spell",
      sourceId: "contract_mez",
      appliedByKind: "system",
      appliedById: "system",
    } as any,
    now0,
  );

  const hostileSpell: SpellDefinition = {
    id: "contract_damage_npc",
    name: "Contract Bolt",
    kind: "damage_single_npc",
    classId: "any",
    minLevel: 1,
    description: "test",
    resourceType: "mana",
    resourceCost: 10,
    cooldownMs: 5_000,
    damageMultiplier: 1,
    flatBonus: 0,
    school: "arcane" as any,
  } as any;

  const sessionId = "sess_caster";
  const entities = new FakeEntities();
  entities.set(sessionId, {
    id: "ent_caster",
    type: "player",
    ownerSessionId: sessionId,
    roomId: "prime_shard:0,0",
    x: 0,
    z: 0,
    hp: 50,
    maxHp: 50,
    alive: true,
  });

  const session = { id: sessionId, character: caster, roomId: "prime_shard:0,0" };
  const ctx: any = { session, entities, nowMs: now0 };

  const manaBefore = (caster.progression as any).powerResources.mana.current;

  const out = await castSpellForCharacter(ctx, caster, hostileSpell, "");
  assert.equal(String(out).includes("mesmer"), true);

  const cdRoot = (caster.progression as any).cooldowns ?? {};
  const spellsBucket = cdRoot.spells ?? {};
  assert.equal(spellsBucket[hostileSpell.id], undefined, "deny-path must not start cooldown");

  const manaAfter = (caster.progression as any).powerResources.mana.current;
  assert.equal(manaAfter, manaBefore, "deny-path must not spend mana");
});

test("[contract] mez breaks on damage", async () => {
  const targetChar = makeChar("t1", "Target");

  const now0 = 3_000_000;
  applyStatusEffect(
    targetChar,
    {
      id: "mez_contract_test2",
      name: "Mesmerize",
      durationMs: 30_000,
      maxStacks: 1,
      stacks: 1,
      modifiers: {},
      tags: ["mez"],
      sourceKind: "spell",
      sourceId: "contract_mez",
      appliedByKind: "system",
      appliedById: "system",
    } as any,
    now0,
  );

  const ent: any = {
    id: "ent_target",
    type: "player",
    ownerSessionId: "sess_target",
    roomId: "prime_shard:0,0",
    x: 0,
    z: 0,
    hp: 50,
    maxHp: 50,
    alive: true,
  };

  // Sanity: mez present.
  assert.equal(
    getActiveStatusEffects(targetChar as any, now0).some((e: any) => (e?.tags ?? []).includes("mez")),
    true,
  );

  applySimpleDamageToPlayer(ent, 5, targetChar as any, "physical" as any, { ignoreServiceProtection: true } as any);

  assert.equal(
    getActiveStatusEffects(targetChar as any, Date.now()).some((e: any) => (e?.tags ?? []).includes("mez")),
    false,
  );
});
