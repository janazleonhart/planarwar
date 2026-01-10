// worldcore/test/codexGoblin.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeNpcMeleeDamage,
  applySimpleDamageToPlayer,
} from "../combat/entityCombat";

test("Codex Goblin: melee damage uses hp-based baseline", () => {
  const goblin: any = {
    id: "npc_codex_1",
    type: "npc",
    maxHp: 400,
    hp: 400,
  };

  // With 400 maxHp and no attackPower, base is ~3% of its own HP → 12.
  const base = Math.max(1, Math.round(400 * 0.03));

  const oldRandom = Math.random;
  try {
    // Force the roll to the center of the 0.8–1.2 band: 1.0x
    let used = false;
    (Math as any).random = () => {
      used = true;
      return 0.5; // 0.8 + 0.5 * 0.4 = 1.0
    };

    const dmg = computeNpcMeleeDamage(goblin);
    assert.equal(used, true, "computeNpcMeleeDamage should use Math.random()");
    assert.equal(dmg, base, "Codex Goblin damage should match hp-based baseline at center roll");
  } finally {
    (Math as any).random = oldRandom;
  }
});

test("Codex Goblin: damage flows through applySimpleDamageToPlayer", () => {
  const goblin: any = {
    id: "npc_codex_2",
    type: "npc",
    maxHp: 400,
    hp: 400,
  };

  const player: any = {
    id: "player_test",
    type: "player",
    maxHp: 100,
    hp: 100,
  };

  const oldRandom = Math.random;
  try {
    // Again, force a 1.0x multiplier for determinism
    (Math as any).random = () => 0.5;

    const dmg = computeNpcMeleeDamage(goblin);
    const { newHp, maxHp, killed } = applySimpleDamageToPlayer(player, dmg);

    assert.equal(maxHp, 100);
    assert.equal(newHp, 100 - dmg);
    assert.equal(killed, newHp <= 0 ? true : false);
  } finally {
    (Math as any).random = oldRandom;
  }
});
