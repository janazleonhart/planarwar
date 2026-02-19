// worldcore/test/contract_npcShieldAbsorbsDamage.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { applyStatusEffectToEntity, getActiveStatusEffectsForEntity } from "../combat/StatusEffects";

test("[contract] NpcManager.applyDamage: NPC shields/absorbs reduce incoming damage (depletes + removes)", () => {
  const realNow = Date.now;
  Date.now = () => 5_000_000;
  try {
    const entities = new EntityManager();
    const npcs = new NpcManager(entities);

    const roomId = "room:shield";
    const npc = npcs.spawnNpcById("training_dummy", roomId, 0, 0, 0) as any;
    assert.ok(npc?.entityId, "npc should spawn");

    const ent: any = entities.get(npc.entityId);
    assert.ok(ent, "npc entity should exist");

    // Apply a shield that absorbs 10 damage.
    applyStatusEffectToEntity(
      ent,
      {
        id: "se_test_npc_shield",
        sourceKind: "spell",
        sourceId: "test_shield",
        name: "Test NPC Shield",
        durationMs: 10_000,
        modifiers: {},
        tags: ["shield"],
        absorb: { amount: 10 },
      } as any,
      5_000_000,
    );

    const hp0 = ent.hp;
    assert.ok(typeof hp0 === "number" && hp0 > 0, "npc should have hp");

    // Hit for 8: fully absorbed.
    const hp1 = npcs.applyDamage(npc.entityId, 8, { entityId: "attacker", damageSchool: "physical" } as any);
    assert.equal(hp1, hp0);
    assert.equal(ent.hp, hp0);

    // Hit for 5: remaining shield is 2, so 3 goes through.
    const hp2 = npcs.applyDamage(npc.entityId, 5, { entityId: "attacker", damageSchool: "physical" } as any);
    assert.equal(hp2, hp0 - 3);
    assert.equal(ent.hp, hp0 - 3);

    // Shield should be depleted + removed.
    const after = getActiveStatusEffectsForEntity(ent, 5_000_000);
    assert.equal(after.filter((e) => (e.tags ?? []).includes("shield")).length, 0);
  } finally {
    Date.now = realNow;
  }
});
