// worldcore/test/contract_pet_role_kits.test.ts
// Contract: Pet Role Kits v1 apply status effects / taunt hooks.

import test from "node:test";
import assert from "node:assert/strict";
import { tickPetsForCharacter } from "../pets/PetAi";
import { getActiveStatusEffectsForEntity, getActiveStatusEffects } from "../combat/StatusEffects";

function dummyChar(id: string): any {
  return { id, name: id, level: 1, hp: 100, maxHp: 100, progression: { statusEffects: { active: {} } } };
}

function makeCtx(opts: {
  sessionId: string;
  ownerEntityId: string;
  roomId: string;
  ownerHp: number;
  ownerMaxHp: number;
  petRole: string;
  engagedTargetId?: string;
  withTaunt?: boolean;
}): any {
  const ownerEnt: any = {
    id: opts.ownerEntityId,
    type: "player",
    roomId: opts.roomId,
    engagedTargetId: opts.engagedTargetId,
    alive: true,
    hp: opts.ownerHp,
    maxHp: opts.ownerMaxHp,
  };

  const petEnt: any = {
    id: "pet.1",
    type: "pet",
    roomId: opts.roomId,
    ownerEntityId: opts.ownerEntityId,
    petMode: "defensive",
    followOwner: true,
    petRole: opts.petRole,
    alive: true,
    hp: 40,
    maxHp: 40,
  };

  const target: any = {
    id: "npc.1",
    type: "npc",
    roomId: opts.roomId,
    alive: true,
    hp: 50,
    maxHp: 50,
    name: "rat",
  };

  const entities = {
    getEntityByOwner: (sid: string) => (sid === opts.sessionId ? ownerEnt : undefined),
    getPetByOwnerEntityId: (oid: string) => (oid === opts.ownerEntityId ? petEnt : undefined),
    getEntitiesInRoom: (rid: string) => (rid === opts.roomId ? [ownerEnt, petEnt, target] : []),
  };

  // Build via IIFE so TS doesn't flag the captured variable as possibly undefined.
  const npcs = opts.withTaunt
    ? (() => {
        const svc = {
          tauntCalls: 0,
          taunt: (_npcId: string, _taunterId: string) => {
            svc.tauntCalls++;
            return true;
          },
        };
        return svc;
      })()
    : undefined;

  const ctx: any = {
    session: { id: opts.sessionId },
    entities,
    npcs,
    sessions: { values: () => [] },
  };

  return { ctx, ownerEnt, petEnt, target, npcs };
}

function hasEntityEffect(entity: any, id: string, nowMs: number): boolean {
  const list = getActiveStatusEffectsForEntity(entity, nowMs);
  return list.some((e) => e.id === id);
}

function hasCharEffect(char: any, id: string, nowMs: number): boolean {
  const list = getActiveStatusEffects(char, nowMs);
  return list.some((e) => e.id === id);
}

// Force kits + attacks to be eligible immediately.
function primeEnv(): void {
  process.env.PW_PET_AI_COOLDOWN_MS = "0";
  process.env.PW_PET_KIT_MEND_CD_MS = "0";
  process.env.PW_PET_KIT_REGEN_CD_MS = "0";
  process.env.PW_PET_KIT_STONEHIDE_CD_MS = "0";
  process.env.PW_PET_KIT_TAUNT_CD_MS = "0";
  process.env.PW_PET_KIT_REND_CD_MS = "0";
  process.env.PW_PET_KIT_DISRUPT_CD_MS = "0";
}

test("[contract] pet kits: dps applies rend DOT", async () => {
  primeEnv();
  const { ctx, target } = makeCtx({
    sessionId: "sess.dps",
    ownerEntityId: "player.dps",
    roomId: "prime_shard:0,0",
    ownerHp: 100,
    ownerMaxHp: 100,
    petRole: "pet_dps",
    engagedTargetId: "npc.1",
  });

  const ownerChar = dummyChar("char.dps");
  const perform = async () => "[world] Pet slashes!";

  await tickPetsForCharacter(ctx as any, ownerChar as any, 1000, { perform });
  assert.ok(hasEntityEffect(target, "pet_rend", 1000), "expected pet_rend on target");
});

test("[contract] pet kits: utility applies disrupt debuff", async () => {
  primeEnv();
  const { ctx, target } = makeCtx({
    sessionId: "sess.util2",
    ownerEntityId: "player.util2",
    roomId: "prime_shard:0,0",
    ownerHp: 100,
    ownerMaxHp: 100,
    petRole: "pet_utility",
    engagedTargetId: "npc.1",
  });

  const ownerChar = dummyChar("char.util2");
  const perform = async () => "[world] Pet pokes!";

  await tickPetsForCharacter(ctx as any, ownerChar as any, 1000, { perform });
  assert.ok(hasEntityEffect(target, "pet_disrupt", 1000), "expected pet_disrupt on target");
});

test("[contract] pet kits: tank applies stonehide and taunts", async () => {
  primeEnv();
  const { ctx, petEnt, npcs } = makeCtx({
    sessionId: "sess.tank",
    ownerEntityId: "player.tank",
    roomId: "prime_shard:0,0",
    ownerHp: 100,
    ownerMaxHp: 100,
    petRole: "pet_tank",
    engagedTargetId: "npc.1",
    withTaunt: true,
  });

  const ownerChar = dummyChar("char.tank");
  const perform = async () => "[world] Pet smashes!";

  await tickPetsForCharacter(ctx as any, ownerChar as any, 1000, { perform });
  assert.ok(hasEntityEffect(petEnt, "pet_stonehide", 1000), "expected pet_stonehide on pet");
  assert.ok((npcs as any).tauntCalls >= 1, "expected taunt to be called");
});

test("[contract] pet kits: heal applies regen HOT when moderately injured", async () => {
  primeEnv();
  const { ctx } = makeCtx({
    sessionId: "sess.heal2",
    ownerEntityId: "player.heal2",
    roomId: "prime_shard:0,0",
    ownerHp: 75,
    ownerMaxHp: 100,
    petRole: "pet_heal",
    engagedTargetId: "npc.1",
  });

  const ownerChar = dummyChar("char.heal2");
  const perform = async () => "[world] Pet nips!";

  await tickPetsForCharacter(ctx as any, ownerChar as any, 1000, { perform });
  assert.ok(hasCharEffect(ownerChar, "pet_regen", 1000), "expected pet_regen on character state");
});
