// worldcore/test/contract_statusEffects_clearOnDeath.test.ts
//
// Contract: death clears combat status effects.
// - Corpses should not keep ticking DOTs.
// - DOT ticking should stop immediately when the target dies, even if multiple ticks are overdue.

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyStatusEffectToEntity,
  getActiveStatusEffectsForEntity,
  tickEntityStatusEffectsAndApplyDots,
} from "../combat/StatusEffects";

function makeNpc(id = "npc.test") {
  return {
    id,
    type: "npc",
    name: "Test NPC",
    hp: 10,
    maxHp: 10,
    alive: true,
  } as any;
}

test("[contract] DOT tick stops on death and clears all status effects", () => {
  const npc = makeNpc("npc.dotkill");
  const now0 = 0;

  applyStatusEffectToEntity(
    npc,
    {
      id: "bleed",
      name: "Bleed",
      durationMs: 60_000,
      modifiers: {},
      dot: {
        tickIntervalMs: 1,
        perTickDamage: 6, // 10 HP => two ticks to kill
        damageSchool: "pure",
      },
    },
    now0,
  );

  let ticks = 0;
  tickEntityStatusEffectsAndApplyDots(npc, 10, (amount) => {
    ticks += 1;
    npc.hp = Math.max(0, npc.hp - amount);
    npc.alive = npc.hp > 0;
  });

  assert.equal(npc.hp, 0, "target must be dead");
  assert.equal(npc.alive, false, "target must be marked not alive");
  assert.equal(ticks, 2, "DOT should stop ticking once the target dies");
  assert.equal(getActiveStatusEffectsForEntity(npc).length, 0, "death must clear effects");
});

test("[contract] dead entity tick is a no-op and clears effects without applying damage", () => {
  const npc = makeNpc("npc.dead");
  npc.hp = 0;
  npc.alive = false;

  applyStatusEffectToEntity(
    npc,
    {
      id: "burning",
      name: "Burning",
      durationMs: 60_000,
      modifiers: {},
      dot: {
        tickIntervalMs: 1,
        perTickDamage: 1,
        damageSchool: "fire",
      },
    },
    0,
  );

  let applied = 0;
  tickEntityStatusEffectsAndApplyDots(npc, 10, () => {
    applied += 1;
  });

  assert.equal(applied, 0, "DOT must not apply to corpses");
  assert.equal(getActiveStatusEffectsForEntity(npc).length, 0, "corpse tick must clear effects");
});
