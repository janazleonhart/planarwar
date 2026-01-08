// worldcore/test/cowardice.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { applySimpleDamageToPlayer } from "../combat/entityCombat";
import type { Entity } from "../shared/Entity";
import {
  type CharacterState,
  defaultAttributes,
  defaultInventory,
  defaultEquipment,
  defaultSpellbook,
  defaultAbilities,
  defaultProgression,
} from "../characters/CharacterTypes";

function makePlayerEntity(hp: number = 100, maxHp: number = 100): Entity & {
  inCombatUntil?: number;
  inCombat?: boolean;
} {
  return {
    id: "player-1",
    type: "player",
    roomId: "room-1",
    ownerSessionId: "session-1",
    x: 0,
    y: 0,
    z: 0,
    rotY: 0,
    hp,
    maxHp,
    alive: true,
    name: "TestPlayer",
  };
}

function makeBaseChar(): CharacterState {
  const now = new Date();

  return {
    id: "char-1",
    userId: "user-1",
    shardId: "prime_shard",
    name: "Coward Tester",
    classId: "warrior",
    level: 1,
    xp: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    lastRegionId: "prime_shard:0,0",
    appearanceTag: null,
    attributes: defaultAttributes(),
    inventory: defaultInventory(),
    equipment: defaultEquipment(),
    spellbook: defaultSpellbook(),
    abilities: defaultAbilities(),
    progression: defaultProgression(),
    stateVersion: 1,
    createdAt: now,
    updatedAt: now,
    guildId: null,
  };
}

test("cowardice: no flags → damage is unchanged", () => {
  const player = makePlayerEntity(100, 100);
  const char = makeBaseChar();

  const base = applySimpleDamageToPlayer(player, 10, char);

  assert.equal(
    base.newHp,
    90,
    "Without cowardice flags, 10 damage should reduce HP from 100 to 90",
  );
  assert.equal(
    player.hp,
    90,
    "Entity hp field should match result.newHp",
  );
  assert.equal(base.killed, false, "Hit should not be lethal");
  assert.ok(
    player.inCombatUntil && player.inCombatUntil > Date.now(),
    "Player should be marked in combat",
  );
});

test("cowardice: active stacks increase damage taken", () => {
  const playerNoCoward = makePlayerEntity(100, 100);
  const charNoCoward = makeBaseChar();

  const resultNoCoward = applySimpleDamageToPlayer(
    playerNoCoward,
    10,
    charNoCoward,
  );

  const playerCoward = makePlayerEntity(100, 100);
  const charCoward = makeBaseChar();

  const future = Date.now() + 60_000;

  charCoward.progression = {
    ...charCoward.progression,
    flags: {
      ...(charCoward.progression.flags ?? {}),
      // Pretend walkto risk mode has applied a few cowardice stacks.
      walktoCowardiceStacks: 3,
      walktoCowardiceUntilMs: future,
    },
  };

  const resultCoward = applySimpleDamageToPlayer(
    playerCoward,
    10,
    charCoward,
  );

  // Sanity: base should still be 90 → 10 damage.
  assert.equal(
    resultNoCoward.newHp,
    90,
    "Baseline damage should still be exactly 10 HP",
  );

  // With cowardice stacks, we EXPECT strictly more damage than baseline.
  // Exact multiplier is implementation/ENV-dependent; we only assert monotonicity.
  assert.ok(
    resultCoward.newHp < resultNoCoward.newHp,
    `Cowardice stacks should cause more damage (HP ${resultCoward.newHp} < ${resultNoCoward.newHp})`,
  );
  assert.equal(
    playerCoward.hp,
    resultCoward.newHp,
    "Entity hp field should match result.newHp under cowardice",
  );
});

test("cowardice: expired stacks do not increase damage", () => {
  const playerBase = makePlayerEntity(100, 100);
  const charBase = makeBaseChar();

  const base = applySimpleDamageToPlayer(playerBase, 10, charBase);

  const playerExpired = makePlayerEntity(100, 100);
  const charExpired = makeBaseChar();

  const past = Date.now() - 60_000;

  charExpired.progression = {
    ...charExpired.progression,
    flags: {
      ...(charExpired.progression.flags ?? {}),
      walktoCowardiceStacks: 5,
      walktoCowardiceUntilMs: past,
    },
  };

  const expired = applySimpleDamageToPlayer(
    playerExpired,
    10,
    charExpired,
  );

  assert.equal(
    base.newHp,
    90,
    "Baseline 10 damage should reduce HP to 90",
  );
  assert.equal(
    expired.newHp,
    base.newHp,
    "Expired cowardice stacks must NOT increase damage taken",
  );
});
