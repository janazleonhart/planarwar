import assert from "node:assert/strict";
import test from "node:test";

import {
  applySimpleDamageToPlayer,
  isDeadEntity,
} from "../combat/entityCombat";
import { type Entity } from "../shared/Entity";

test("applying damage reduces HP and flags death", () => {
  const player: Entity & { inCombatUntil?: number } = {
    id: "player-1",
    type: "player",
    roomId: "room-1",
    ownerSessionId: "session-1",
    x: 0,
    y: 0,
    z: 0,
    rotY: 0,
    hp: 50,
    maxHp: 50,
    alive: true,
    name: "TestPlayer",
  };

  const firstHit = applySimpleDamageToPlayer(player, 20);
  assert.equal(firstHit.newHp, 30);
  assert.equal(player.hp, 30);
  assert.equal(firstHit.killed, false);
  assert.equal(isDeadEntity(player), false);
  assert.ok(player.inCombatUntil && player.inCombatUntil > Date.now());

  const lethalHit = applySimpleDamageToPlayer(player, 100);
  assert.equal(lethalHit.newHp, 0);
  assert.equal(lethalHit.killed, true);
  assert.equal(player.hp, 0);
  assert.equal(player.alive, false);
  assert.equal(isDeadEntity(player), true);
});
