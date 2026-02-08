// worldcore/test/contract_dotSingleNpcAlias.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { castSpellForCharacter } from "../mud/MudSpells";
import { withRandomSequenceAsync } from "./testUtils";
import { tickEntityStatusEffectsAndApplyDots } from "../combat/StatusEffects";

type AnyChar = any;
type AnySession = any;
type AnyEntity = any;

function makeChar(args: { id: string; name: string; classId?: string; level?: number; shardId?: string }): AnyChar {
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
    attributes: { int: 10 },
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
    ignoreServiceProtection: false,
  };
}

const TEST_DOT_ALIAS: any = {
  id: "test_dot_spell_alias",
  name: "Test Pain (alias)",
  // Legacy alias kind we want to keep supported.
  kind: "dot_single_npc",
  classId: "any",
  minLevel: 1,
  isDebug: true,
  resourceCost: 0,
  cooldownMs: 0,
  damageMultiplier: 1.0,
  flatBonus: 0,
  school: "shadow",
  statusEffect: {
    id: "test_dot_alias",
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

test("[contract] dot_single_npc spell kind applies NPC DOT status effect and ticks damage", async () => {
  const roomId = "prime_shard:0,0";

  const caster = makeChar({ id: "char_caster", name: "Caster", classId: "mage" });
  const casterSession = makeSession({ id: "sess_caster", name: "Caster", roomId, userId: "u1", char: caster });

  const npc: AnyEntity = {
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
    x: 0,
    z: 0,
    hp: 100,
    maxHp: 100,
    tags: [],
  };

  const ctx = makeCtx({ roomId, casterSession, allSessions: [casterSession], entities: [selfEnt, npc] });

  const line = await withRandomSequenceAsync([0.5, 0.9], async () => {
    return castSpellForCharacter(ctx as any, caster as any, TEST_DOT_ALIAS as any, "Rat");
  });

  assert.ok(String(line ?? "").toLowerCase().includes("afflict"), "dot alias should produce an afflict line");

  const inst = (npc as any).combatStatusEffects?.active?.[TEST_DOT_ALIAS.statusEffect.id];
  assert.ok(inst?.dot, "dot_single_npc must install dot payload on NPC");

  const perTick = Number(inst.dot.perTickDamage ?? 0);
  const interval = Number(inst.dot.tickIntervalMs ?? 0);
  const nextTick = Number(inst.dot.nextTickAtMs ?? 0);

  assert.ok(perTick > 0 && interval > 0 && nextTick > 0, "DOT payload must have sane tick scheduler fields");

  const applyDamage = (amount: number) => {
    npc.hp = Math.max(0, npc.hp - Math.floor(amount));
  };

  tickEntityStatusEffectsAndApplyDots(npc as any, nextTick, (amt: number) => applyDamage(amt));
  tickEntityStatusEffectsAndApplyDots(npc as any, nextTick + interval, (amt: number) => applyDamage(amt));
  tickEntityStatusEffectsAndApplyDots(npc as any, nextTick + interval * 2, (amt: number) => applyDamage(amt));

  const dmg = 1000 - npc.hp;
  assert.equal(dmg, perTick * 3, "DOT baseline total must equal perTick * 3");
});
