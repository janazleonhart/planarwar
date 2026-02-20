// worldcore/test/contract_absorbBreakdown_schoolFilter.test.ts
//
// Contract: absorb breakdown respects damage-school filtering.
// - Shields with `absorb.schools` only consume matching incoming damage.
// - Non-matching shields MUST NOT appear in breakdown and MUST NOT be consumed.

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { SessionManager } from "../core/SessionManager";
import { NpcManager } from "../npc/NpcManager";
import { applyStatusEffectToEntity } from "../combat/StatusEffects";

test("[contract] Absorb breakdown respects damage-school filtering", () => {
  process.env.WORLDCORE_TEST = "1";

  const entities = new EntityManager();
  const sessions = new SessionManager();
  const npcs = new NpcManager(entities, sessions);

  const roomId = "room.absorb.school";
  const spawned = npcs.spawnNpcById("town_rat", roomId, 0, 0, 0);
  assert.ok(spawned, "npc spawn");

  const npcEnt: any = entities.get(spawned!.entityId);
  assert.ok(npcEnt, "npc entity");

  const realNow = Date.now;
  const t0 = 500_000;
  const t1 = 500_050;
  const tNow = 500_200;
  Date.now = () => tNow;

  try {
    const durationMs = 60_000;

    // Fire-only shield with higher priority.
    applyStatusEffectToEntity(
      npcEnt,
      {
        id: "shield_fireward",
        sourceKind: "spell",
        sourceId: "fireward",
        name: "Fire Ward",
        durationMs,
        modifiers: {},
        absorb: { amount: 5, priority: 2, schools: ["fire"] },
        appliedByKind: "system",
        appliedById: "SYS",
      } as any,
      t0,
    );

    // Any-school shield with lower priority.
    applyStatusEffectToEntity(
      npcEnt,
      {
        id: "shield_barrier_any",
        sourceKind: "spell",
        sourceId: "barrier",
        name: "Barrier",
        durationMs,
        modifiers: {},
        absorb: { amount: 5, priority: 1 },
        appliedByKind: "system",
        appliedById: "SYS",
      } as any,
      t1,
    );

    // 1) Physical hit should NOT consume the Fire Ward. Only Barrier absorbs.
    const phys = npcs.applyDamageDetailed(spawned!.entityId, 4, { damageSchool: "physical", tag: "test" } as any);
    assert.ok(phys, "expected phys damage result");
    assert.equal(phys!.absorbed, 4);
    assert.equal(phys!.effectiveDamage, 0);
    assert.deepEqual(phys!.absorbBreakdown, [{ name: "Barrier", priority: 1, absorbed: 4 }]);

    // 2) Fire hit should consume remaining Fire Ward first (p2), then Barrier (p1).
    const fire = npcs.applyDamageDetailed(spawned!.entityId, 6, { damageSchool: "fire", tag: "test" } as any);
    assert.ok(fire, "expected fire damage result");
    assert.equal(fire!.absorbed, 6);
    assert.equal(fire!.effectiveDamage, 0);

    // Fire Ward had 5 remaining, Barrier had 1 remaining (after phys hit).
    assert.deepEqual(fire!.absorbBreakdown, [
      { name: "Fire Ward", priority: 2, absorbed: 5 },
      { name: "Barrier", priority: 1, absorbed: 1 },
    ]);
  } finally {
    Date.now = realNow;
  }
});
