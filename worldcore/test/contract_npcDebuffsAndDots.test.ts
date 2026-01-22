// worldcore/test/contract_npcDebuffsAndDots.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { castSpellForCharacter } from "../mud/MudSpells";
import { withRandomSequenceAsync } from "./testUtils";
import { tickEntityStatusEffectsAndApplyDots } from "../combat/StatusEffects";

type AnyChar = any;
type AnySession = any;
type AnyEntity = any;

function makeChar(args: {
  id: string;
  name: string;
  classId?: string;
  level?: number;
  shardId?: string;
}): AnyChar {
  const classId = args.classId ?? "mage";
  const shardId = args.shardId ?? "prime_shard";
  const level = args.level ?? 1;

  return {
    id: args.id,
    name: args.name,
    classId,
    level,
    shardId,
    spellbook: { known: {} },
    progression: {
      powerResources: {
        mana: { current: 100, max: 100 },
      },
      cooldowns: {},
      skills: {},
    },
    flags: {},
    statusEffects: {},
    attributes: { int: 10 }, // give CombatEngine something deterministic-ish
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

function makeCtx(args: {
  roomId: string;
  casterSession: AnySession;
  allSessions: AnySession[];
  entities: AnyEntity[];
}): any {
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
    ignoreServiceProtection: false,
  };
}

const TEST_BOLT: any = {
  id: "test_bolt_npc",
  name: "Test Bolt",
  kind: "damage_single_npc",
  classId: "any",
  minLevel: 1,
  isDebug: true,
  resourceCost: 0,
  cooldownMs: 0,
  damageMultiplier: 1.0,
  flatBonus: 0,
  school: "arcane",
};

const TEST_VULN_DEBUFF: any = {
  id: "test_vuln_debuff",
  name: "Test Vulnerability",
  kind: "debuff_single_npc",
  classId: "any",
  minLevel: 1,
  isDebug: true,
  resourceCost: 0,
  cooldownMs: 0,
  school: "shadow",
  statusEffect: {
    id: "test_vuln",
    name: "Vulnerability",
    durationMs: 60_000,
    stacks: 1,
    maxStacks: 1,
    modifiers: {
      // Double all incoming damage for easy assertions.
      damageTakenPct: 1.0,
    },
    tags: ["debuff", "test"],
  },
};

const TEST_DOT: any = {
  id: "test_dot_spell",
  name: "Test Pain",
  kind: "damage_dot_single_npc",
  classId: "any",
  minLevel: 1,
  isDebug: true,
  resourceCost: 0,
  cooldownMs: 0,
  damageMultiplier: 1.0,
  flatBonus: 0,
  school: "shadow",
  statusEffect: {
    id: "test_dot",
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

test("[contract] NPC debuff increases subsequent direct spell damage", async () => {
  const roomId = "prime_shard:0,0";

  const caster = makeChar({ id: "char_caster", name: "Caster", classId: "mage" });
  const casterSession = makeSession({ id: "sess_caster", name: "Caster", roomId, userId: "u1", char: caster });

  // Baseline NPC target
  const npc1: AnyEntity = {
    id: "npc_rat_1",
    type: "npc",
    name: "Rat",
    roomId,
    hp: 1000,
    maxHp: 1000,
    tags: [],
  };

  const selfEnt: AnyEntity = {
    id: "player_caster_ent",
    type: "player",
    name: "Caster",
    roomId,
    ownerSessionId: casterSession.id,
    hp: 100,
    maxHp: 100,
    tags: [],
  };

  const ctx1 = makeCtx({ roomId, casterSession, allSessions: [casterSession], entities: [selfEnt, npc1] });

  // Deterministic damage roll (no crit).
  await withRandomSequenceAsync([0.5, 0.9], async () => {
    await castSpellForCharacter(ctx1, caster, TEST_BOLT, "Rat");
  });

  const dmgWithoutDebuff = 1000 - npc1.hp;
  assert.ok(dmgWithoutDebuff > 0, "baseline bolt should deal damage");

  // Fresh NPC with the same baseline.
  const npc2: AnyEntity = {
    id: "npc_rat_2",
    type: "npc",
    name: "Rat",
    roomId,
    hp: 1000,
    maxHp: 1000,
    tags: [],
  };

  const ctx2 = makeCtx({ roomId, casterSession, allSessions: [casterSession], entities: [selfEnt, npc2] });

  await castSpellForCharacter(ctx2, caster, TEST_VULN_DEBUFF, "Rat");

  await withRandomSequenceAsync([0.5, 0.9], async () => {
    await castSpellForCharacter(ctx2, caster, TEST_BOLT, "Rat");
  });

  const dmgWithDebuff = 1000 - npc2.hp;
  assert.equal(
    dmgWithDebuff,
    dmgWithoutDebuff * 2,
    "debuff damageTakenPct=+100% must double subsequent direct damage",
  );
});

test("[contract] NPC DOT ticks apply damage and respect damageTaken debuffs", async () => {
  const roomId = "prime_shard:0,0";

  const caster = makeChar({ id: "char_caster_dot", name: "Caster", classId: "mage" });
  const casterSession = makeSession({ id: "sess_caster_dot", name: "Caster", roomId, userId: "u1", char: caster });

  const selfEnt: AnyEntity = {
    id: "player_caster_ent_dot",
    type: "player",
    name: "Caster",
    roomId,
    ownerSessionId: casterSession.id,
    hp: 100,
    maxHp: 100,
    tags: [],
  };

  // --- Case A: DOT baseline ---
  const npcA: AnyEntity = {
    id: "npc_rat_dot_a",
    type: "npc",
    name: "Rat",
    roomId,
    hp: 1000,
    maxHp: 1000,
    tags: [],
  };

  const ctxA = makeCtx({ roomId, casterSession, allSessions: [casterSession], entities: [selfEnt, npcA] });

  await withRandomSequenceAsync([0.5, 0.9], async () => {
    await castSpellForCharacter(ctxA, caster, TEST_DOT, "Rat");
  });

  const instA = (npcA as any).combatStatusEffects?.active?.[TEST_DOT.statusEffect.id];
  assert.ok(instA?.dot, "DOT spell must install dot payload on NPC");
  const perTickA = Number(instA.dot.perTickDamage ?? 0);
  const intervalA = Number(instA.dot.tickIntervalMs ?? 0);
  const nextTickA = Number(instA.dot.nextTickAtMs ?? 0);

  assert.ok(perTickA > 0 && intervalA > 0 && nextTickA > 0, "DOT payload must have sane tick scheduler fields");

  const applyDamageA = (amount: number) => {
    npcA.hp = Math.max(0, npcA.hp - Math.floor(amount));
  };

  // Tick exactly on schedule (3 ticks over 6s).
  tickEntityStatusEffectsAndApplyDots(npcA, nextTickA, (amt) => applyDamageA(amt));
  tickEntityStatusEffectsAndApplyDots(npcA, nextTickA + intervalA, (amt) => applyDamageA(amt));
  tickEntityStatusEffectsAndApplyDots(npcA, nextTickA + intervalA * 2, (amt) => applyDamageA(amt));

  const dmgDotBase = 1000 - npcA.hp;
  assert.equal(dmgDotBase, perTickA * 3, "DOT baseline total must equal perTick * 3");

  // --- Case B: DOT + vulnerability debuff doubles tick damage ---
  const npcB: AnyEntity = {
    id: "npc_rat_dot_b",
    type: "npc",
    name: "Rat",
    roomId,
    hp: 1000,
    maxHp: 1000,
    tags: [],
  };

  const ctxB = makeCtx({ roomId, casterSession, allSessions: [casterSession], entities: [selfEnt, npcB] });

  await withRandomSequenceAsync([0.5, 0.9], async () => {
    await castSpellForCharacter(ctxB, caster, TEST_DOT, "Rat");
  });

  await castSpellForCharacter(ctxB, caster, TEST_VULN_DEBUFF, "Rat");

  const instB = (npcB as any).combatStatusEffects?.active?.[TEST_DOT.statusEffect.id];
  assert.ok(instB?.dot, "DOT spell must install dot payload on NPC (case B)");
  const perTickB = Number(instB.dot.perTickDamage ?? 0);
  const intervalB = Number(instB.dot.tickIntervalMs ?? 0);
  const nextTickB = Number(instB.dot.nextTickAtMs ?? 0);

  const applyDamageB = (amount: number) => {
    npcB.hp = Math.max(0, npcB.hp - Math.floor(amount));
  };

  tickEntityStatusEffectsAndApplyDots(npcB, nextTickB, (amt) => applyDamageB(amt));
  tickEntityStatusEffectsAndApplyDots(npcB, nextTickB + intervalB, (amt) => applyDamageB(amt));
  tickEntityStatusEffectsAndApplyDots(npcB, nextTickB + intervalB * 2, (amt) => applyDamageB(amt));

  const dmgDotDebuffed = 1000 - npcB.hp;
  assert.equal(
    dmgDotDebuffed,
    perTickB * 3 * 2,
    "damageTaken debuff must double DOT tick damage at tick time",
  );
});
