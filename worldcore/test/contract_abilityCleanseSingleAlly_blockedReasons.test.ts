// worldcore/test/contract_abilityCleanseSingleAlly_blockedReasons.test.ts
//
// Contract: ability-based cleanse on an ally uses the same blocked-reason taxonomy as spell cleanse,
// runs through formatBlockedReasonLine (including ability prefix), and still spends resources / starts cooldown.

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";

import { handleAbilityCommand } from "../mud/MudAbilities";
import { ABILITIES } from "../abilities/AbilityTypes";

function makeChar(id: string, name: string): CharacterState {
  return {
    id,
    userId: "u",
    shardId: "prime_shard",
    name,
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

function makeCtx(opts: {
  casterSessionId: string;
  casterEntity: any;
  casterChar: CharacterState;
  allySessionId: string;
  allyEntity: any;
  allyChar: CharacterState;
  nowMs: number;
}) {
  const { casterSessionId, casterEntity, casterChar, allySessionId, allyEntity, allyChar, nowMs } = opts;

  const casterSession = { id: casterSessionId, shardId: "prime_shard", roomId: "prime_shard:0,0", character: casterChar };
  const allySession = { id: allySessionId, shardId: "prime_shard", roomId: "prime_shard:0,0", character: allyChar };

  return {
    nowMs,
    session: casterSession,
    sessions: {
      getAllSessions: () => [casterSession, allySession],
    },
    entities: {
      getEntityByOwner: (ownerSessionId: string) => {
        if (ownerSessionId === casterSessionId) return casterEntity;
        if (ownerSessionId === allySessionId) return allyEntity;
        return null;
      },
    },
  } as any;
}

test("[contract] ability cleanse_single_ally: blocked-reason mapping + prefix, but still spends/cools", async () => {
  const caster = makeChar("c1", "Cleaner");
  const ally = makeChar("a1", "Ally");
  const now0 = 2_000_000;

  (ABILITIES as any).contract_cleanse_ally = {
    id: "contract_cleanse_ally",
    name: "Contract Cleanse Ally",
    kind: "cleanse_single_ally",
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

  (caster as any).abilities.learned.contract_cleanse_ally = true;

  const casterSessionId = "sess_caster";
  const allySessionId = "sess_ally";

  const casterEntity = {
    id: "ent_caster",
    type: "player",
    ownerSessionId: casterSessionId,
    roomId: "prime_shard:0,0",
    x: 0,
    z: 0,
  };

  const allyEntity = {
    id: "ent_ally",
    type: "player",
    ownerSessionId: allySessionId,
    roomId: "prime_shard:0,0",
    x: 1,
    z: 0,
  };

  const ctx = makeCtx({
    casterSessionId,
    casterEntity,
    casterChar: caster,
    allySessionId,
    allyEntity,
    allyChar: ally,
    nowMs: now0,
  });

  const manaBefore = (caster.progression as any).powerResources.mana.current;

  const out = await handleAbilityCommand(ctx, caster, "contract_cleanse_ally", "Ally");
  assert.equal(String(out), "[world] [ability:Contract Cleanse Ally] Ally has nothing to cleanse.");

  const cdRoot = (caster.progression as any).cooldowns ?? {};
  const abilitiesBucket = cdRoot.abilities ?? {};
  const cdEntry = abilitiesBucket.contract_cleanse_ally;
  assert.ok(cdEntry && typeof cdEntry.readyAt === "number", "should start cooldown even if nothing was cleansed");

  const manaAfter = (caster.progression as any).powerResources.mana.current;
  assert.equal(manaAfter, manaBefore - 10, "should spend mana even if nothing was cleansed");
});
