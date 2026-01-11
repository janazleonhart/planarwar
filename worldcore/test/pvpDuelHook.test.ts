// worldcore/test/pvpDuelHook.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { applySimpleDamageToPlayer } from "../combat/entityCombat";

test("PvP/Duel damage hook exists and is behavior-neutral in v1", () => {
  const char: any = {
    id: "char_pvp_hook",
    name: "PvP Hook Tester",
    classId: "warrior",
    level: 1,
    maxHp: 100,
    hp: 100,
    progression: {},
  };

  const ent: any = {
    id: "e_pvp_hook",
    type: "player",
    maxHp: 100,
    hp: 100,
  };

  // Baseline
  ent.hp = 100;
  const base = applySimpleDamageToPlayer(ent, 10, char, "physical");
  const baseDamage = 100 - base.newHp;
  assert.equal(baseDamage, 10);

  // PvP mode (currently multiplier=1)
  ent.hp = 100;
  const pvp = applySimpleDamageToPlayer(ent, 10, char, "physical", { mode: "pvp" });
  assert.equal(100 - pvp.newHp, baseDamage);

  // Duel mode (currently multiplier=1)
  ent.hp = 100;
  const duel = applySimpleDamageToPlayer(ent, 10, char, "physical", { mode: "duel" });
  assert.equal(100 - duel.newHp, baseDamage);

  // Explicit pve mode should also match baseline
  ent.hp = 100;
  const pve = applySimpleDamageToPlayer(ent, 10, char, "physical", { mode: "pve" });
  assert.equal(100 - pve.newHp, baseDamage);
});
