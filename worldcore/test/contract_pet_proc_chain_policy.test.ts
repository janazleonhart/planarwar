// worldcore/test/contract_pet_proc_chain_policy.test.ts
// Contract: Proc chain policy is safe by default, and supports explicit opt-in proc-on-proc.
//
// Scenario:
// - An NPC hits a pet.
// - Pet has an on_being_hit "Thorns" proc that damages the attacker.
// - Pet also has an on_hit proc (Expose Arcana) that applies a debuff via spellId.
//
// When proc-on-proc is enabled and both procs opt-in (allowProcChain=true), the Thorns proc
// may trigger a chained evaluation that applies the on_hit debuff to the attacker.
// When disabled (default), the chained debuff should NOT apply.

import test from "node:test";
import assert from "node:assert/strict";

import { applySimpleNpcCounterAttack } from "../combat/NpcCombat";
import { getActiveStatusEffectsForEntity } from "../combat/StatusEffects";

function dummyChar(id: string): any {
  const now = new Date();
  return {
    id,
    userId: "user-test",
    name: "Tester",
    shardId: "prime_shard",
    classId: "warrior",
    level: 10,
    xp: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    lastRegionId: null,
    appearanceTag: null,
    attributes: { str: 15, agi: 12, int: 10, sta: 12, wis: 10, cha: 10 },
    inventory: { bags: [], currency: {} },
    equipment: {},
    spellbook: { known: {} },
    abilities: {},
    progression: {},
    stateVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function makeCtx(owner: any, pet: any, npc: any): any {
  const ctx: any = {
    session: { character: dummyChar("char-proc-chain") },
    entities: {
      get: (id: string) => (id === owner.id ? owner : id === pet.id ? pet : id === npc.id ? npc : null),
    },
    items: {
      get: (itemId: string) => {
        if (itemId === "test_thorns_armor") {
          return {
            id: itemId,
            name: "Test Thorns Armor",
            stats: {
              procs: [
                {
                  trigger: "on_being_hit",
                  chance: 1,
                  icdMs: 0,
                  damage: 1,
                  applyTo: "target",
                  allowProcChain: true,
                  name: "Thorns",
                },
              ],
            },
          };
        }
        if (itemId === "test_chain_weapon") {
          return {
            id: itemId,
            name: "Test Chain Weapon",
            stats: {
              procs: [
                {
                  trigger: "on_hit",
                  chance: 1,
                  icdMs: 0,
                  spellId: "archmage_expose_arcana",
                  allowProcChain: true,
                  name: "Expose Arcana",
                },
              ],
            },
          };
        }
        return null;
      },
      getItem: (itemId: string) => (ctx.items as any).get(itemId),
      getItemTemplate: (itemId: string) => {
        const it = (ctx.items as any).get(itemId);
        return it ? { id: it.id, name: it.name, stats: it.stats } : null;
      },
    },
    npcs: {
      applyDamage: (entityId: string, dmg: number) => {
        if (entityId !== npc.id) return null;
        npc.hp = Math.max(0, npc.hp - dmg);
        npc.alive = npc.hp > 0;
        return npc.hp;
      },
      // Important: do NOT return a training dummy proto/template here.
      // Training dummies never counter-attack, which would bypass this proc chain scenario.
      getNpcStateByEntityId: (id: string) => (id === npc.id ? { protoId: "test_melee_npc", templateId: "test_melee_npc" } : null),
      recordDamage: () => {},
    },
  };

  return ctx;
}

function hasExposeArcana(npc: any): boolean {
  const active = getActiveStatusEffectsForEntity(npc);
  return active.some((e: any) => String(e.id).includes("expose_arcana"));
}

test("[contract] proc chain policy: default disables proc-on-proc (no chained debuff)", async () => {
  const oldAllow = process.env.PW_PROC_ALLOW_PROC_ON_PROC;
  const oldDepth = process.env.PW_PROC_MAX_DEPTH;

  // Defaults should be safe; explicitly ensure the env isn't enabling chaining.
  delete process.env.PW_PROC_ALLOW_PROC_ON_PROC;
  delete process.env.PW_PROC_MAX_DEPTH;

  const owner: any = {
    id: "player-proc-chain",
    type: "player",
    roomId: "room-proc-chain",
    ownerSessionId: "sess-proc-chain",
    hp: 100,
    maxHp: 100,
    alive: true,
    name: "Player",
  };

  const pet: any = {
    id: "pet-proc-chain",
    type: "pet",
    roomId: "room-proc-chain",
    ownerEntityId: owner.id,
    hp: 60,
    maxHp: 60,
    alive: true,
    name: "Test Pet",
    equipment: { armor: "test_thorns_armor", weapon: "test_chain_weapon" },
  };

  const npc: any = {
    id: "npc-proc-chain",
    type: "npc",
    roomId: "room-proc-chain",
    hp: 5000,
    maxHp: 5000,
    alive: true,
    name: "Target Dummy",
    protoId: "test_melee_npc",
    templateId: "test_melee_npc",
    armor: 0,
    resist: {},
  };

  const ctx = makeCtx(owner, pet, npc);

  const rng = () => 0.5;

  await applySimpleNpcCounterAttack(ctx, npc, pet, { rng });

  assert.equal(hasExposeArcana(npc), false, "expected no chained Expose Arcana debuff by default");

  // restore
  if (oldAllow === undefined) delete process.env.PW_PROC_ALLOW_PROC_ON_PROC;
  else process.env.PW_PROC_ALLOW_PROC_ON_PROC = oldAllow;

  if (oldDepth === undefined) delete process.env.PW_PROC_MAX_DEPTH;
  else process.env.PW_PROC_MAX_DEPTH = oldDepth;
});

test("[contract] proc chain policy: enabled + opt-in allows proc-on-proc (chained debuff applies)", async () => {
  const oldAllow = process.env.PW_PROC_ALLOW_PROC_ON_PROC;
  const oldDepth = process.env.PW_PROC_MAX_DEPTH;

  process.env.PW_PROC_ALLOW_PROC_ON_PROC = "1";
  process.env.PW_PROC_MAX_DEPTH = "2";

  const owner: any = {
    id: "player-proc-chain-2",
    type: "player",
    roomId: "room-proc-chain-2",
    ownerSessionId: "sess-proc-chain-2",
    hp: 100,
    maxHp: 100,
    alive: true,
    name: "Player",
  };

  const pet: any = {
    id: "pet-proc-chain-2",
    type: "pet",
    roomId: "room-proc-chain-2",
    ownerEntityId: owner.id,
    hp: 60,
    maxHp: 60,
    alive: true,
    name: "Test Pet",
    equipment: { armor: "test_thorns_armor", weapon: "test_chain_weapon" },
  };

  const npc: any = {
    id: "npc-proc-chain-2",
    type: "npc",
    roomId: "room-proc-chain-2",
    hp: 5000,
    maxHp: 5000,
    alive: true,
    name: "Target Dummy",
    protoId: "test_melee_npc",
    templateId: "test_melee_npc",
    armor: 0,
    resist: {},
  };

  const ctx = makeCtx(owner, pet, npc);

  const rng = () => 0.5;

  await applySimpleNpcCounterAttack(ctx, npc, pet, { rng });

  assert.equal(hasExposeArcana(npc), true, "expected chained Expose Arcana debuff when proc-on-proc is enabled");

  // restore
  if (oldAllow === undefined) delete process.env.PW_PROC_ALLOW_PROC_ON_PROC;
  else process.env.PW_PROC_ALLOW_PROC_ON_PROC = oldAllow;

  if (oldDepth === undefined) delete process.env.PW_PROC_MAX_DEPTH;
  else process.env.PW_PROC_MAX_DEPTH = oldDepth;
});
