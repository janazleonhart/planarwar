// worldcore/test/contract_absorbBreakdown_order.test.ts
//
// Contract: absorb breakdown is ordered deterministically by:
//   1) higher priority first
//   2) then oldest-first (lowest appliedAtMs)
// and the CombatLog renders that order verbatim.
//

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { SessionManager } from "../core/SessionManager";
import { NpcManager } from "../npc/NpcManager";
import { applyStatusEffectToEntity } from "../combat/StatusEffects";
import { formatWorldSpellDirectDamageLine } from "../combat/CombatLog";

test("[contract] Absorb breakdown is priority-desc then oldest-first and log preserves order", () => {
  process.env.WORLDCORE_TEST = "1";

  const entities = new EntityManager();
  const sessions = new SessionManager();
  const npcs = new NpcManager(entities, sessions);

  const roomId = "room.absorb.order";
  const spawned = npcs.spawnNpcById("town_rat", roomId, 0, 0, 0);
  assert.ok(spawned, "npc spawn");

  const npcEnt: any = entities.get(spawned!.entityId);
  assert.ok(npcEnt, "npc entity");

  // IMPORTANT: NpcManager.applyDamageDetailed uses Date.now() when evaluating
  // status-effect expiry. Make sure our test shields are NOT expired.
  // (We apply them at t0/t1/t2 and evaluate damage at now=tNow.)
  const realNow = Date.now;
  const t0 = 900_000;
  const t1 = 900_050;
  const t2 = 900_100;
  const tNow = 900_300;

  Date.now = () => tNow;

  try {
    // Apply 3 shields:
    // - Ward (p2) older
    // - Ward II (p2) newer
    // - Barrier (p1)
    // Duration is long enough to still be active at tNow.
    const durationMs = 10_000;

    applyStatusEffectToEntity(
      npcEnt,
      {
        id: "shield_ward_p2_old",
        sourceKind: "spell",
        sourceId: "ward",
        name: "Ward",
        durationMs,
        modifiers: {},
        absorb: { amount: 5, priority: 2 },
        appliedByKind: "system",
        appliedById: "SYS",
      },
      t0,
    );

    applyStatusEffectToEntity(
      npcEnt,
      {
        id: "shield_barrier_p1",
        sourceKind: "spell",
        sourceId: "barrier",
        name: "Barrier",
        durationMs,
        modifiers: {},
        absorb: { amount: 5, priority: 1 },
        appliedByKind: "system",
        appliedById: "SYS",
      },
      t1,
    );

    applyStatusEffectToEntity(
      npcEnt,
      {
        id: "shield_ward2_p2_new",
        sourceKind: "spell",
        sourceId: "ward2",
        name: "Ward II",
        durationMs,
        modifiers: {},
        absorb: { amount: 5, priority: 2 },
        appliedByKind: "system",
        appliedById: "SYS",
      },
      t2,
    );

    // Hit for 8 physical:
    // - Ward (p2, old) absorbs 5
    // - Ward II (p2, new) absorbs 3
    // - Barrier (p1) untouched
    const d = npcs.applyDamageDetailed(spawned!.entityId, 8, { damageSchool: "physical", tag: "test" });
    assert.ok(d, "expected damage result");

    assert.equal(d!.absorbed, 8);
    assert.equal(d!.effectiveDamage, 0);

    assert.deepEqual(d!.absorbBreakdown, [
      { name: "Ward", priority: 2, absorbed: 5 },
      { name: "Ward II", priority: 2, absorbed: 3 },
    ]);

    const line = formatWorldSpellDirectDamageLine({
      spellName: "Arcane Bolt",
      targetName: "Town Rat",
      damage: 8,
      absorbed: d!.absorbed,
      absorbBreakdown: d!.absorbBreakdown,
      hpAfter: d!.hp,
      maxHp: (npcEnt as any).maxHp,
    });

    assert.ok(
      line.includes("(8 absorbed by Ward[p2]=5 > Ward II[p2]=3)"),
      `expected ordered breakdown, got: ${line}`,
    );
  } finally {
    Date.now = realNow;
  }
});
