// worldcore/test/contract_abilityCleanseSelf_blockedReasons.test.ts
//
// Contract: ability-based cleanse uses the same blocked-reason taxonomy as spell cleanse,
// and runs through formatBlockedReasonLine (including ability prefix).
//
// NOTE: Cleanse still spends resources / starts cooldown before discovering "nothing to cleanse",
// matching spell behavior.

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";

import { handleAbilityCommand } from "../mud/MudAbilities";
import { ABILITIES } from "../abilities/AbilityTypes";

function makeChar(id: string): CharacterState {
  return {
    id,
    userId: "u",
    shardId: "prime_shard",
    name: "Cleaner",
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

  getEntityByOwner(ownerSessionId: string) {
    return this.byOwner.get(ownerSessionId) ?? null;
  }

  getAll() {
    return this.all;
  }
}

test("[contract] ability cleanse: blocked-reason mapping + prefix, but still spends/cools", async () => {
  const caster = makeChar("c1");
  const now0 = 2_000_000;

  // Inject a minimal cleanse ability into the registry for the contract test.
  (ABILITIES as any).contract_cleanse = {
    id: "contract_cleanse",
    name: "Contract Cleanse",
    kind: "cleanse_self",
    classId: "any",
    minLevel: 1,
    description: "test",
    resourceType: "mana",
    resourceCost: 10,
    cooldownMs: 5_000,
    cleanse: {
      tags: ["poison"],
      maxToRemove: 1,
    },
  } as any;

  // Mark it known.
  (caster as any).abilities.learned.contract_cleanse = true;

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

  const out = await handleAbilityCommand(ctx, caster, "contract_cleanse");
  assert.equal(String(out), "[world] [ability:Contract Cleanse] Nothing clings to you.");

  const cdRoot = (caster.progression as any).cooldowns ?? {};
  const abilitiesBucket = cdRoot.abilities ?? {};
  const cdEntry = abilitiesBucket.contract_cleanse;
  assert.ok(
    cdEntry && typeof cdEntry.readyAt === "number",
    "should start cooldown even if nothing was cleansed"
  );

  const manaAfter = (caster.progression as any).powerResources.mana.current;
  assert.equal(manaAfter, manaBefore - 10, "should spend mana even if nothing was cleansed");
});
