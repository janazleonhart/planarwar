// worldcore/test/contract_abilityKnockdownBlocks_noCostNoCooldown.test.ts
//
// Contract: knockdown must deny ability usage BEFORE spending resources or starting cooldowns.

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";

import { handleAbilityCommand } from "../mud/MudAbilities";
import { applyStatusEffect } from "../combat/StatusEffects";
import { ABILITIES } from "../abilities/AbilityTypes";

function makeChar(id: string): CharacterState {
  return {
    id,
    userId: "u",
    shardId: "prime_shard",
    name: "Caster",
    classId: "warrior",
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
    abilities: { learned: {} } as any,
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
  private all: any[] = [];

  set(ownerSessionId: string, ent: any) {
    this.byOwner.set(ownerSessionId, ent);
    this.all.push(ent);
  }

  add(ent: any) {
    this.all.push(ent);
  }

  getEntityByOwner(ownerSessionId: string) {
    return this.byOwner.get(ownerSessionId) ?? null;
  }

  getAll() {
    return this.all;
  }
}

test("[contract] knockdown blocks ability use before cost/cooldown", async () => {
  const caster = makeChar("c1");
  const now0 = 2_000_000;

  // Inject a minimal melee ability into the registry for the contract test.
  (ABILITIES as any).contract_kick = {
    id: "contract_kick",
    name: "Contract Kick",
    kind: "melee_single",
    classId: "any",
    minLevel: 1,
    description: "test",
    resourceType: "mana",
    resourceCost: 10,
    cooldownMs: 5_000,
    damageMultiplier: 1,
    flatBonus: 0,
  } as any;

  // Mark it known.
  (caster as any).abilities.learned.contract_kick = true;

  applyStatusEffect(
    caster,
    {
      id: "knockdown_contract_test",
      name: "Knockdown",
      durationMs: 30_000,
      maxStacks: 1,
      stacks: 1,
      modifiers: {},
      tags: ["knockdown"],
      sourceKind: "spell",
      sourceId: "contract_knockdown",
      appliedByKind: "system",
      appliedById: "system",
    },
    now0,
  );

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
  entities.add({ id: "npc_dummy", type: "npc", name: "Dummy", roomId: "prime_shard:0,0", x: 1, z: 0 });

  const session = { id: sessionId, character: caster, roomId: "prime_shard:0,0" };
  const ctx: any = { session, entities, nowMs: now0 };

  const manaBefore = (caster.progression as any).powerResources.mana.current;

  const out = await handleAbilityCommand(ctx, caster, "contract_kick", "npc_dummy");
  assert.equal(String(out).toLowerCase().includes("knocked"), true);

  const cdRoot = (caster.progression as any).cooldowns ?? {};
  const abilitiesBucket = cdRoot.abilities ?? {};
  assert.equal(abilitiesBucket.contract_kick, undefined, "deny-path must not start cooldown");

  const manaAfter = (caster.progression as any).powerResources.mana.current;
  assert.equal(manaAfter, manaBefore, "deny-path must not spend mana");
});
