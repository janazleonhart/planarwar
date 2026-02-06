// worldcore/test/contract_pet_proc_v2_castSpell.test.ts
// Contract: Pet gear procs can "cast" spell ids (v2) to apply status effects.

import test from "node:test";
import assert from "node:assert/strict";

import { performNpcAttack } from "../combat/NpcCombat";
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

test("[contract] pet proc v2: spellId proc applies a status effect to the target", async () => {
  const char = dummyChar("char-proc-v2");

  const owner: any = {
    id: "player-proc-v2",
    type: "player",
    roomId: "room-proc-v2",
    ownerSessionId: "sess-proc-v2",
    hp: 100,
    maxHp: 100,
    alive: true,
    name: "Player",
  };

  const pet: any = {
    id: "pet-proc-v2",
    type: "pet",
    roomId: "room-proc-v2",
    ownerEntityId: owner.id,
    hp: 60,
    maxHp: 60,
    alive: true,
    name: "Test Pet",
    equipment: { weapon: "test_proc_weapon" },
  };

  const npc: any = {
    id: "npc-proc-v2",
    type: "npc",
    roomId: "room-proc-v2",
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
      // NpcCombat's proc collection calls itemService.getItemTemplate / getItem / get.
      // We support a few common shapes to keep the test robust.
      get: (itemId: string) => {
        if (itemId !== "test_proc_weapon") return null;
        return {
          id: itemId,
          name: "Test Proc Weapon",
          stats: {
            procs: [
              {
                trigger: "on_hit",
                chance: 1,
                icdMs: 0,
                spellId: "archmage_expose_arcana",
                name: "Expose Arcana",
              },
            ],
          },
        };
      },
      getItem: (itemId: string) => {
        return (ctx.items as any).get(itemId);
      },
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
      getNpcStateByEntityId: (id: string) => (id === npc.id ? { protoId: "training_dummy", templateId: "training_dummy" } : null),
      recordDamage: () => {},
    },
  };

  // Deterministic RNG: avoid dodge/parry/block buckets while still passing proc chance.
  const rng = () => 0.5;

  await performNpcAttack(ctx, char, pet, npc, { rng });

  const active = getActiveStatusEffectsForEntity(npc);
  const hasExpose = active.some((e: any) => String(e.id).includes("expose_arcana"));
  assert.equal(hasExpose, true, "expected Expose Arcana debuff to be applied by proc");
});
