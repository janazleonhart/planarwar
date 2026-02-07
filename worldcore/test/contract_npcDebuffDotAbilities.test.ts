// worldcore/test/contract_npcDebuffDotAbilities.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { handleAbilityCommand } from "../mud/MudAbilities";
import { ABILITIES } from "../abilities/AbilityTypes";
import { tickEntityStatusEffectsAndApplyDots } from "../combat/StatusEffects";

type AnyChar = any;
type AnySession = any;
type AnyEntity = any;

function makeChar(args: { id: string; name: string; classId?: string; level?: number; shardId?: string }): AnyChar {
  const classId = args.classId ?? "warrior";
  const shardId = args.shardId ?? "prime_shard";
  const level = args.level ?? 1;

  return {
    id: args.id,
    name: args.name,
    classId,
    level,
    shardId,
    attributes: { str: 10, agi: 10, int: 10, sta: 10, wis: 10, cha: 10 },
    progression: {
      powerResources: {
        mana: { current: 100, max: 100 },
        fury: { current: 100, max: 100 },
      },
      cooldowns: {},
      skills: {},
    },
    equipment: {},
    abilities: { learned: {} },
    flags: {},
  };
}

function makeSession(args: { id: string; name: string; roomId: string; userId: string; char: AnyChar }): AnySession {
  return {
    id: args.id,
    name: args.name,
    roomId: args.roomId,
    userId: args.userId,
    character: args.char,
    char: args.char,
  };
}

function makeCtx(args: { roomId: string; casterSession: AnySession; allSessions: AnySession[]; entities: AnyEntity[] }): any {
  const sessionsById = new Map<string, AnySession>();
  for (const s of args.allSessions) sessionsById.set(String(s.id), s);

  const entities = {
    getAll: () => args.entities,
    getEntityByOwner: (ownerSessionId: string) =>
      args.entities.find((e) => String(e.ownerSessionId ?? "") === String(ownerSessionId)) ?? null,
  };

  const sessions = {
    getAllSessions: () => args.allSessions,
    get: (id: string) => sessionsById.get(String(id)) ?? null,
    send: () => {
      // no-op for tests
    },
  };

  return {
    session: args.casterSession,
    sessions,
    entities,
    items: undefined,
    ignoreServiceProtection: false,
  };
}

const AB_DEBUFF_ID = "test_ability_vuln_debuff";
const AB_DOT_ID = "test_ability_pain_dot";

// Install temporary AbilityTypes for this contract suite.
function installTestAbilities(): void {
  (ABILITIES as any)[AB_DEBUFF_ID] = {
    id: AB_DEBUFF_ID,
    name: "Test Vulnerability (Ability)",
    description: "Contract-only debuff ability",
    classId: "any",
    minLevel: 1,
    kind: "debuff_single_npc",
    resourceType: "mana",
    resourceCost: 0,
    cooldownMs: 0,
    statusEffect: {
      id: "test_ability_vuln",
      name: "Vulnerability",
      durationMs: 60_000,
      stacks: 1,
      maxStacks: 1,
      modifiers: {
        damageTakenPct: 1.0,
      },
      tags: ["debuff", "test"],
    },
  };

  (ABILITIES as any)[AB_DOT_ID] = {
    id: AB_DOT_ID,
    name: "Test Pain (Ability)",
    description: "Contract-only DOT ability",
    classId: "any",
    minLevel: 1,
    kind: "damage_dot_single_npc",
    resourceType: "mana",
    resourceCost: 0,
    cooldownMs: 0,
    spellSchool: "shadow",
    damageMultiplier: 1.0,
    flatBonus: 0,
    statusEffect: {
      id: "test_ability_dot",
      name: "Pain",
      durationMs: 6000,
      stacks: 1,
      maxStacks: 1,
      modifiers: {},
      tags: ["dot", "test"],
      dot: {
        tickIntervalMs: 2000,
        spreadDamageAcrossTicks: true,
      },
    },
  };
}

function uninstallTestAbilities(): void {
  delete (ABILITIES as any)[AB_DEBUFF_ID];
  delete (ABILITIES as any)[AB_DOT_ID];
}

test("[contract] ability debuff_single_npc installs NPC combatStatusEffects", async () => {
  installTestAbilities();
  try {
    const roomId = "prime_shard:0,0";

    const caster = makeChar({ id: "char_abil_caster", name: "Caster", classId: "warrior" });
    (caster as any).abilities.learned[AB_DEBUFF_ID] = true;

    const casterSession = makeSession({ id: "sess_abil_caster", name: "Caster", roomId, userId: "u1", char: caster });

    const selfEnt: AnyEntity = {
      id: "player_caster_ent_abil",
      type: "player",
      name: "Caster",
      roomId,
      ownerSessionId: casterSession.id,
      hp: 100,
      maxHp: 100,
      tags: [],
    };

    const npc: AnyEntity = {
      id: "npc_rat_abil_1",
      type: "npc",
      name: "Rat",
      roomId,
      hp: 1000,
      maxHp: 1000,
      tags: [],
    };

    const ctx = makeCtx({ roomId, casterSession, allSessions: [casterSession], entities: [selfEnt, npc] });

    const line = await handleAbilityCommand(ctx, caster as any, AB_DEBUFF_ID, "Rat");
    assert.ok(String(line).includes("afflict"), "debuff ability should produce an afflict line");

    const inst = (npc as any).combatStatusEffects?.active?.["test_ability_vuln"];
    assert.ok(inst, "NPC must have an active status instance after debuff ability");
    assert.equal(inst.id, "test_ability_vuln");
  } finally {
    uninstallTestAbilities();
  }
});

test("[contract] ability damage_dot_single_npc installs DOT payload and ticks via StatusEffects", async () => {
  installTestAbilities();
  try {
    const roomId = "prime_shard:0,0";

    const caster = makeChar({ id: "char_abil_caster2", name: "Caster", classId: "warrior" });
    (caster as any).abilities.learned[AB_DOT_ID] = true;

    const casterSession = makeSession({ id: "sess_abil_caster2", name: "Caster", roomId, userId: "u1", char: caster });

    const selfEnt: AnyEntity = {
      id: "player_caster_ent_abil2",
      type: "player",
      name: "Caster",
      roomId,
      ownerSessionId: casterSession.id,
      hp: 100,
      maxHp: 100,
      tags: [],
    };

    const npc: AnyEntity = {
      id: "npc_rat_abil_dot",
      type: "npc",
      name: "Rat",
      roomId,
      hp: 1000,
      maxHp: 1000,
      tags: [],
    };

    const ctx = makeCtx({ roomId, casterSession, allSessions: [casterSession], entities: [selfEnt, npc] });

    const line = await handleAbilityCommand(ctx, caster as any, AB_DOT_ID, "Rat");
    assert.ok(String(line).includes("afflict"), "DOT ability should produce an afflict line");

    const inst = (npc as any).combatStatusEffects?.active?.["test_ability_dot"];
    assert.ok(inst?.dot, "DOT ability must install dot payload on NPC");

    const perTick = Number(inst.dot.perTickDamage ?? 0);
    const interval = Number(inst.dot.tickIntervalMs ?? 0);
    const nextTick = Number(inst.dot.nextTickAtMs ?? 0);

    assert.ok(perTick > 0 && interval > 0 && nextTick > 0, "DOT payload must have sane tick scheduling fields");

    const applyDamage = (amount: number) => {
      npc.hp = Math.max(0, npc.hp - Math.floor(amount));
    };

    tickEntityStatusEffectsAndApplyDots(npc as any, nextTick, (amt) => applyDamage(amt));
    tickEntityStatusEffectsAndApplyDots(npc as any, nextTick + interval, (amt) => applyDamage(amt));
    tickEntityStatusEffectsAndApplyDots(npc as any, nextTick + interval * 2, (amt) => applyDamage(amt));

    const dmg = 1000 - npc.hp;
    assert.equal(dmg, perTick * 3, "3 ticks over 6s must deal perTick*3");
  } finally {
    uninstallTestAbilities();
  }
});

