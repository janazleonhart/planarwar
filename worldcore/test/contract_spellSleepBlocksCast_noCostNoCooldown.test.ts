// worldcore/test/contract_spellSleepBlocksCast_noCostNoCooldown.test.ts
//
// Contract: sleep must deny spell casting BEFORE spending resources or starting cooldowns.

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import type { SpellDefinition } from "../spells/SpellTypes";

import { castSpellForCharacter } from "../mud/MudSpells";
import { applyStatusEffect } from "../combat/StatusEffects";

function makeChar(id: string): CharacterState {
  return {
    id,
    userId: "u",
    shardId: "prime_shard",
    name: "Caster",
    classId: "archmage",
    level: 1,
    xp: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    lastRegionId: null,
    appearanceTag: null,
    attributes: { str: 1, agi: 1, int: 1, sta: 1, wis: 1, cha: 1 },
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

test("[contract] sleep blocks spell casting before cost/cooldown", async () => {
  const caster = makeChar("c1");
  const now0 = 2_000_000;

  applyStatusEffect(
    caster,
    {
      id: "sleep_contract_test",
      name: "Sleep",
      durationMs: 30_000,
      maxStacks: 1,
      stacks: 1,
      modifiers: {},
      tags: ["sleep"],
      sourceKind: "spell",
      sourceId: "contract_sleep",
      appliedByKind: "system",
      appliedById: "system",
    },
    now0,
  );

  const spell: SpellDefinition = {
    id: "contract_heal_self_sleep",
    name: "Contract Heal",
    kind: "heal_self",
    classId: "any",
    minLevel: 1,
    description: "test",
    resourceType: "mana",
    resourceCost: 10,
    cooldownMs: 5_000,
    healAmount: 10,
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
  });

  const session = { id: sessionId, character: caster, roomId: "prime_shard:0,0" };
  const ctx: any = { session, entities, nowMs: now0 };

  const manaBefore = (caster.progression as any).powerResources.mana.current;

  const out = await castSpellForCharacter(ctx, caster, spell, "");
  assert.equal(String(out).toLowerCase().includes("asleep"), true);

  const cdRoot = (caster.progression as any).cooldowns ?? {};
  const spellsBucket = cdRoot.spells ?? {};
  assert.equal(spellsBucket[spell.id], undefined, "deny-path must not start cooldown");

  const manaAfter = (caster.progression as any).powerResources.mana.current;
  assert.equal(manaAfter, manaBefore, "deny-path must not spend mana");
});
