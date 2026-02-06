// worldcore/test/contract_pet_proc_slot_icd.test.ts
// Contract: Pet gear procs support per-slot internal cooldown buckets, and armor "on_being_hit" procs fire.

import test from "node:test";
import assert from "node:assert/strict";

import { performNpcAttack, applySimpleNpcCounterAttack } from "../combat/NpcCombat";
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

test("[contract] pet proc icd: per-slot bucket blocks multiple weapon procs in same swing", async () => {
  const char = dummyChar("char-proc-slot-icd");

  const owner: any = {
    id: "player-proc-slot-icd",
    type: "player",
    roomId: "room-proc-slot-icd",
    ownerSessionId: "sess-proc-slot-icd",
    hp: 100,
    maxHp: 100,
    alive: true,
    name: "Player",
  };

  const pet: any = {
    id: "pet-proc-slot-icd",
    type: "pet",
    roomId: "room-proc-slot-icd",
    ownerEntityId: owner.id,
    hp: 60,
    maxHp: 60,
    alive: true,
    name: "Test Pet",
    equipment: { weapon: "weapon_two_procs" },
  };

  const npc: any = {
    id: "npc-proc-slot-icd",
    type: "npc",
    roomId: "room-proc-slot-icd",
    hp: 5000,
    maxHp: 5000,
    alive: true,
    name: "Target Dummy",
    protoId: "training_dummy",
    templateId: "training_dummy",
    armor: 0,
    resist: {},
  };

  const ctx: any = {
    entities: {
      get: (id: string) => (id === owner.id ? owner : id === pet.id ? pet : id === npc.id ? npc : null),
    },
    items: {
      get: (itemId: string) => {
        if (itemId !== "weapon_two_procs") return null;
        return {
          id: itemId,
          name: "Weapon With Two Procs",
          stats: {
            procs: [
              { trigger: "on_hit", chance: 1, icdMs: 5000, damage: 1, name: "Proc A" },
              { trigger: "on_hit", chance: 1, icdMs: 5000, damage: 1, name: "Proc B" },
            ],
          },
        };
      },
      getItem: (id: string) => (ctx.items as any).get(id),
      getItemTemplate: (id: string) => {
        const it = (ctx.items as any).get(id);
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
      getNpcStateByEntityId: (id: string) => (id === npc.id ? { protoId: "training_dummy", templateId: "training_dummy" } : null),
      recordDamage: () => {},
    },
  };

  const rng = () => 0.5;

  const originalNow = Date.now;
  try {
    Date.now = () => 1234567890;
    const line = await performNpcAttack(ctx, char, pet, npc, { rng });

    const count = (line.match(/\[proc:/g) ?? []).length;
    assert.equal(count, 1, "expected only one proc line from weapon slot due to per-slot bucket");
  } finally {
    Date.now = originalNow;
  }
});

test("[contract] pet armor proc: on_being_hit can apply a status effect", async () => {
  const char = dummyChar("char-proc-being-hit");

  const owner: any = {
    id: "player-proc-being-hit",
    type: "player",
    roomId: "room-proc-being-hit",
    ownerSessionId: "sess-proc-being-hit",
    hp: 100,
    maxHp: 100,
    alive: true,
    name: "Player",
  };

  const pet: any = {
    id: "pet-proc-being-hit",
    type: "pet",
    roomId: "room-proc-being-hit",
    ownerEntityId: owner.id,
    hp: 60,
    maxHp: 60,
    alive: true,
    name: "Test Pet",
    equipment: { chest: "chest_hit_proc" },
  };

  const attackerNpc: any = {
    id: "npc-proc-being-hit",
    type: "npc",
    roomId: "room-proc-being-hit",
    hp: 5000,
    maxHp: 5000,
    alive: true,
    name: "Bandit",
    protoId: "bandit",
    templateId: "bandit",
    armor: 0,
    resist: {},
  };

  const ctx: any = {
    session: { character: char },
    entities: { get: (id: string) => (id === owner.id ? owner : id === pet.id ? pet : id === attackerNpc.id ? attackerNpc : null) },
    items: {
      get: (itemId: string) => {
        if (itemId !== "chest_hit_proc") return null;
        return {
          id: itemId,
          name: "Reactive Chest",
          stats: {
            procs: [
              {
                trigger: "on_being_hit",
                chance: 1,
                icdMs: 0,
                spellId: "archmage_expose_arcana",
                applyTo: "target",
                name: "Expose Arcana",
              },
            ],
          },
        };
      },
      getItem: (id: string) => (ctx.items as any).get(id),
      getItemTemplate: (id: string) => {
        const it = (ctx.items as any).get(id);
        return it ? { id: it.id, name: it.name, stats: it.stats } : null;
      },
    },
    npcs: {
      applyDamage: (entityId: string, dmg: number) => {
        if (entityId !== attackerNpc.id) return null;
        attackerNpc.hp = Math.max(0, attackerNpc.hp - dmg);
        attackerNpc.alive = attackerNpc.hp > 0;
        return attackerNpc.hp;
      },
      getNpcStateByEntityId: (id: string) => (id === attackerNpc.id ? { protoId: "bandit", templateId: "bandit" } : null),
      recordDamage: () => {},
    },
  };

  const rng = () => 0.5;
  await applySimpleNpcCounterAttack(ctx, attackerNpc, pet, { rng });

  const active = getActiveStatusEffectsForEntity(attackerNpc);
  const hasExpose = active.some((e: any) => String(e.id).includes("expose_arcana"));
  assert.equal(hasExpose, true, "expected Expose Arcana debuff to be applied to attacker by on_being_hit proc");
});
