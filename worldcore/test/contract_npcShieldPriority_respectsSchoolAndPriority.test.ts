// worldcore/test/contract_npcShieldPriority_respectsSchoolAndPriority.test.ts
//
// Verifies that NPC shield/absorb consumption respects BOTH:
// - damage school filtering
// - absorb.priority ordering (higher first)
// while preserving the default behavior for unmatched shields (ignored).

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { applyStatusEffectToEntity, getActiveStatusEffectsForEntity } from "../combat/StatusEffects";

test("[contract] NPC shields: priority ordering respects damage school filtering", () => {
  const realNow = Date.now;
  Date.now = () => 5_000_000;
  try {
    const entities = new EntityManager();
    const npcs = new NpcManager(entities);

    const roomId = "room:shield-priority";
    const npc = npcs.spawnNpcById("training_dummy", roomId, 0, 0, 0) as any;
    assert.ok(npc?.entityId, "npc should spawn");

    const ent: any = entities.get(npc.entityId);
    assert.ok(ent, "npc entity should exist");

    const hp0 = ent.hp;
    assert.ok(typeof hp0 === "number" && hp0 > 0, "npc should have hp");

    // Physical/general shield: absorbs 6, low priority.
    applyStatusEffectToEntity(
      ent,
      {
        id: "se_phys_low",
        sourceKind: "spell",
        sourceId: "shield_phys_low",
        name: "Physical Ward (low)",
        durationMs: 10_000,
        tags: ["shield"],
        absorb: { amount: 6, priority: 0 },
      } as any,
      5_000_000,
    );

    // Fire-only shield: absorbs 5, high priority.
    applyStatusEffectToEntity(
      ent,
      {
        id: "se_fire_high",
        sourceKind: "spell",
        sourceId: "shield_fire_high",
        name: "Fire Ward (high)",
        durationMs: 10_000,
        tags: ["shield"],
        absorb: { amount: 5, schools: ["fire"], priority: 10 },
      } as any,
      5_000_000,
    );

    // Hit with PHYSICAL 4: should consume only the physical/general shield (fire-only ignored).
    const hp1 = npcs.applyDamage(npc.entityId, 4, { entityId: "attacker", damageSchool: "physical" } as any);
    assert.equal(hp1, hp0);
    assert.equal(ent.hp, hp0);

    const mid = getActiveStatusEffectsForEntity(ent, 5_000_000);
    const physMid = mid.find((e) => e.sourceId === "shield_phys_low") as any;
    const fireMid = mid.find((e) => e.sourceId === "shield_fire_high") as any;
    assert.ok(physMid?.absorb, "physical shield should still exist after first hit");
    assert.ok(fireMid?.absorb, "fire shield should still exist after first hit");
    assert.equal(physMid.absorb.remaining, 2, "physical shield should have 2 remaining after absorbing 4");
    assert.equal(fireMid.absorb.remaining, 5, "fire shield should remain untouched on physical hit");

    // Hit with FIRE 7: high-priority fire shield absorbs 5 first, then remaining 2 is absorbed by physical shield.
    const hp2 = npcs.applyDamage(npc.entityId, 7, { entityId: "attacker", damageSchool: "fire" } as any);
    assert.equal(hp2, hp0, "all damage should be absorbed by shields");
    assert.equal(ent.hp, hp0);

    // Both shields should now be depleted + removed.
    const after = getActiveStatusEffectsForEntity(ent, 5_000_000);
    assert.equal(after.filter((e) => (e.tags ?? []).includes("shield")).length, 0, "all shield buckets should be removed");
  } finally {
    Date.now = realNow;
  }
});
