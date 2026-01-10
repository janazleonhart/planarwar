// worldcore/test/damageStacking.test.ts
//
// End-to-end checks that:
//  - cowardice increases incoming damage vs a baseline
//  - Region Peril (RegionDanger aura) further increases damage on top of cowardice.

import test from "node:test";
import assert from "node:assert/strict";

import { applySimpleDamageToPlayer } from "../combat/entityCombat";
import { updateRegionDangerAuraForCharacter } from "../combat/RegionDangerAuras";
import { setRegionDangerScore } from "../world/RegionDanger";

import {
  type CharacterState,
  defaultAttributes,
  defaultInventory,
  defaultEquipment,
  defaultSpellbook,
  defaultAbilities,
  defaultProgression,
} from "../characters/CharacterTypes";

function makeChar(regionId: string): CharacterState {
  const now = new Date();
  const progression = defaultProgression() as any;
  if (!progression.flags) progression.flags = {};

  return {
    id: "char-damage-stack",
    userId: "user-damage-stack",
    shardId: "prime_shard",
    name: "DamageStackTester",
    classId: "warrior",
    level: 1,
    xp: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    lastRegionId: regionId,
    appearanceTag: null,
    attributes: defaultAttributes(),
    inventory: defaultInventory(),
    equipment: defaultEquipment(),
    spellbook: defaultSpellbook(),
    abilities: defaultAbilities(),
    progression,
    stateVersion: 1,
    createdAt: now,
    updatedAt: now,
    guildId: null,
  };
}

test("Cowardice increases incoming damage vs baseline", () => {
  const regionId = "prime_shard:0,0"; // calm center region
  setRegionDangerScore(regionId, 0, "test:reset", 0);

  const baseChar = makeChar(regionId);
  const cowChar = makeChar(regionId);

  // Give the second character some cowardice stacks (not expired).
  const cowAny: any = cowChar;
  const flags = (cowAny.progression.flags ||= {});
  flags.walktoCowardiceStacks = 2;
  flags.walktoCowardiceUntilMs = Date.now() + 60_000;

  const baseEntity: any = { id: "target-base", hp: 1000, maxHp: 1000, alive: true };
  const cowEntity: any = { id: "target-cowardice", hp: 1000, maxHp: 1000, alive: true };

  const baseResult = applySimpleDamageToPlayer(baseEntity, 100, baseChar);
  const cowResult = applySimpleDamageToPlayer(cowEntity, 100, cowChar);

  const baseDamage = 1000 - baseResult.newHp;
  const cowDamage = 1000 - cowResult.newHp;

  assert.ok(
    cowDamage > baseDamage,
    `Expected cowardice to increase damage, but baseline=${baseDamage}, cowardice=${cowDamage}`,
  );
});

test("Region Peril further increases damage on top of cowardice", () => {
  const now = Date.now();
  const regionId = "prime_shard:5,0"; // outer ring, high danger

  // Reset danger score; base tier from ring still makes this dangerous.
  setRegionDangerScore(regionId, 0, "test:reset", now);

  const cowChar = makeChar(regionId);
  const cowAny: any = cowChar;
  const flags = (cowAny.progression.flags ||= {});
  flags.walktoCowardiceStacks = 2;
  flags.walktoCowardiceUntilMs = now + 60_000;

  const entityNoAura: any = {
    id: "target-no-aura",
    hp: 1000,
    maxHp: 1000,
    alive: true,
  };

  const entityWithAura: any = {
    id: "target-with-aura",
    hp: 1000,
    maxHp: 1000,
    alive: true,
  };

  // First: cowardice only (no Region Peril aura yet).
  const resultNoAura = applySimpleDamageToPlayer(
    entityNoAura,
    100,
    cowChar,
  );
  const damageNoAura = 1000 - resultNoAura.newHp;

  // Now apply Region Peril aura based on RegionDanger and hit again.
  updateRegionDangerAuraForCharacter(cowChar, now);

  const resultWithAura = applySimpleDamageToPlayer(
    entityWithAura,
    100,
    cowChar,
  );
  const damageWithAura = 1000 - resultWithAura.newHp;

  assert.ok(
    damageWithAura > damageNoAura,
    `Expected Region Peril aura to further increase damage, but withoutAura=${damageNoAura}, withAura=${damageWithAura}`,
  );
});
