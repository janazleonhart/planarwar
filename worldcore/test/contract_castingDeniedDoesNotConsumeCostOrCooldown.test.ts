// worldcore/test/contract_castingDeniedDoesNotConsumeCostOrCooldown.test.ts
//
// Contract: If a cast/ability attempt is denied *after* resolving a valid target (e.g. service-protected NPC),
// we must NOT consume resource cost and must NOT start cooldowns.
//
// Why: Denial must be “fail-closed” and side-effect free.

import assert from "node:assert/strict";
import test from "node:test";

import { serviceProtectedCombatLine } from "../combat/ServiceProtection";
import { castSpellForCharacter } from "../mud/MudSpells";
import { SPELLS } from "../spells/SpellTypes";
import { handleAbilityCommand } from "../mud/MudAbilities";
import { ABILITIES } from "../abilities/AbilityTypes";

type AnyObj = Record<string, any>;

function makeCtx(roomId: string) {
  const session = { id: "sess_1", roomId };

  const selfEnt: AnyObj = {
    id: "ent_player_1",
    type: "player",
    name: "Tester",
    roomId,
    ownerSessionId: session.id,
  };

  const serviceNpc: AnyObj = {
    id: "ent_npc_service_1",
    type: "npc",
    name: "Test Banker",
    roomId,
    // ServiceProtection.ts checks this flag (or tags/role) to deny combat.
    isService: true,
  };

  const entities = [selfEnt, serviceNpc];

  const entitiesMgr = {
    getAll: () => entities,
    getEntityByOwner: (ownerSessionId: string) =>
      entities.find((e) => e.ownerSessionId === ownerSessionId) ?? null,
  };

  const sessions = {
    sendToSession: () => {},
    sendToRoomExcept: () => {},
    broadcastToRoom: () => {},
  };

  return { session, sessions, entities: entitiesMgr };
}

function snapshot(obj: any) {
  return JSON.parse(JSON.stringify(obj ?? {}));
}

test("[contract] denied spell cast does not consume cost or start cooldowns", async () => {
  const roomId = "prime_shard:0,0";
  const ctx: AnyObj = makeCtx(roomId);

  const spell = SPELLS.mage_fire_bolt;
  assert.ok(spell, "Expected SPELLS.mage_fire_bolt to exist");

  const char: AnyObj = {
    id: "char_1",
    shardId: "prime_shard",
    classId: "mage",
    level: 99,
    hp: 100,
    maxHp: 100,

    // Ensure canUseSpell passes "learned" gate for non-debug spells.
    spellbook: {
      known: { [spell.id]: true },
      cooldowns: {},
    },

    progression: {
      powerResources: {
        mana: { current: 100, max: 100 },
        fury: { current: 100, max: 100 },
      },
      cooldowns: {},
      skills: {},
    },
  };

  const beforeMana = char.progression.powerResources.mana.current;
  const beforeProgCooldowns = snapshot(char.progression.cooldowns);
  const beforeSbCooldowns = snapshot(char.spellbook.cooldowns);

  const line = await castSpellForCharacter(ctx as any, char as any, spell as any, "Test Banker");
  assert.equal(line, serviceProtectedCombatLine("Test Banker"));

  // Resource cost not spent
  assert.equal(char.progression.powerResources.mana.current, beforeMana);

  // No generic cooldown started
  assert.deepEqual(char.progression.cooldowns, beforeProgCooldowns);

  // No spellbook cooldown started
  assert.deepEqual(char.spellbook.cooldowns, beforeSbCooldowns);
});

test("[contract] denied ability use does not consume cost or start cooldowns", async () => {
  const roomId = "prime_shard:0,0";
  const ctx: AnyObj = makeCtx(roomId);

  const ability: AnyObj | undefined =
    (Object.values(ABILITIES as any) as AnyObj[]).find(
      (a) =>
        a &&
        a.kind === "melee_single" &&
        ((a.resourceCost ?? 0) > 0 || (a.cooldownMs ?? 0) > 0)
    ) ??
    (Object.values(ABILITIES as any) as AnyObj[]).find((a) => a && a.kind === "melee_single");

  assert.ok(
    ability,
    "Expected at least one melee_single ability in ABILITIES (preferably with cost or cooldown)."
  );

  const abilityClass = String(ability.classId ?? "any").toLowerCase();
  const classId = abilityClass !== "any" ? abilityClass : "warrior";

  const char: AnyObj = {
    id: "char_2",
    shardId: "prime_shard",
    classId,
    level: 99,
    hp: 100,
    maxHp: 100,
    spellbook: { known: {}, cooldowns: {} },
    progression: {
      powerResources: {
        mana: { current: 100, max: 100 },
        fury: { current: 100, max: 100 },
      },
      cooldowns: {},
      skills: {},
    },
  };

  const beforePower = snapshot(char.progression.powerResources);
  const beforeCooldowns = snapshot(char.progression.cooldowns);

  const line = await handleAbilityCommand(
    ctx as any,
    char as any,
    String(ability.id ?? ability.name),
    "Test Banker"
  );

  assert.equal(line, serviceProtectedCombatLine("Test Banker"));
  assert.deepEqual(char.progression.powerResources, beforePower);
  assert.deepEqual(char.progression.cooldowns, beforeCooldowns);
});
