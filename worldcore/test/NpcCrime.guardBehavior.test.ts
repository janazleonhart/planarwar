// worldcore/test/NpcCrime.guardBehavior.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import {
  CharacterState,
  defaultAbilities,
  defaultAttributes,
  defaultEquipment,
  defaultInventory,
  defaultProgression,
  defaultSpellbook,
} from "../characters/CharacterTypes";

function makeCharacter(): CharacterState {
  return {
    id: "char_guard_test",
    userId: "user_guard_test",
    shardId: "prime_shard",
    name: "Test Rogue",
    classId: "cutthroat",
    level: 5,
    xp: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    lastRegionId: null,
    appearanceTag: null,
    attributes: defaultAttributes(),
    inventory: defaultInventory(),
    equipment: defaultEquipment(),
    spellbook: defaultSpellbook(),
    abilities: defaultAbilities(),
    progression: defaultProgression(),
    stateVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

test("applyDamage records crime when attacking protected NPCs", () => {
  const entities = new EntityManager();
  const npcManager = new NpcManager(entities); // sessions optional in NpcManager

  // town_rat has the "protected_town" tag, so it should trigger crime heat
  const playerEntity = entities.createPlayerForSession("sess_crime", "town_square");
  const npcState = npcManager.spawnNpcById("town_rat", "town_square", 0, 0, 0);
  assert.ok(npcState, "expected NPC to spawn for crime test");

  const attacker = makeCharacter();
  const beforeCrime = attacker.recentCrimeUntil ?? 0;

  const remainingHp = npcManager.applyDamage(npcState!.entityId, 5, {
    entityId: playerEntity.id,
    character: attacker,
  });

  assert.ok(remainingHp !== null, "damage application should succeed");
  assert.ok(
    (attacker.recentCrimeUntil ?? 0) > beforeCrime,
    "crime flag should be set on attacker character state",
  );
  assert.equal(attacker.recentCrimeSeverity, "minor");
});
