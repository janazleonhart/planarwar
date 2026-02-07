// worldcore/test/contract_ranged_verbs_targeting.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { handleRangedAttackAction } from "../mud/actions/MudCombatActions";
import { getTrainingDummyForRoom } from "../mud/MudTrainingDummy";

// Ensure deterministic ranged config for this contract suite.
process.env.PW_RANGED_MAX_RANGE = "14";
process.env.PW_RANGED_FOV_DEG = "140";

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
  const classId = args.classId ?? "outrider";
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
    attributes: { str: 10, agi: 10, int: 10, sta: 10, wis: 10, cha: 10 },
  };
}

function makeSession(args: {
  id: string;
  name: string;
  roomId: string;
  userId: string;
  char: AnyChar;
}): AnySession {
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
    npcs: {
      getNpcStateByEntityId: (id: string) => {
        // We only care about the dummy proto hook for these contracts.
        if (String(id) === "npc_training_dummy") return { protoId: "training_dummy_big" };
        return null;
      },
    },
    ignoreServiceProtection: false,
  };
}

test("[contract] ranged verb: within range + LoS succeeds", async () => {
  const roomId = "prime_shard:0,0";

  const caster = makeChar({ id: "char_ranged_ok", name: "Archer" });
  const casterSession = makeSession({ id: "sess_ranged_ok", name: "Archer", roomId, userId: "u1", char: caster });

  const selfEnt: AnyEntity = {
    id: "player_archer_ent",
    type: "player",
    name: "Archer",
    roomId,
    ownerSessionId: casterSession.id,
    hp: 100,
    maxHp: 100,
    x: 0,
    y: 0,
    z: 0,
    rotY: 0, // facing +Z
    tags: [],
  };

  const dummy: AnyEntity = {
    id: "npc_training_dummy",
    type: "npc",
    name: "Training Dummy",
    roomId,
    hp: 20,
    maxHp: 20,
    alive: true,
    x: 0,
    y: 0,
    z: 6,
    tags: [],
  };

  const ctx = makeCtx({ roomId, casterSession, allSessions: [casterSession], entities: [selfEnt, dummy] });

  const state = getTrainingDummyForRoom(roomId);
  const before = state.hp;
  const line = await handleRangedAttackAction(ctx, caster, "Training Dummy");

  assert.ok(String(line).includes("You"), `Expected a combat line, got: ${line}`);
  const after = getTrainingDummyForRoom(roomId).hp;
  assert.ok(after < before, "Expected dummy HP pool to decrease");
});

test("[contract] ranged verb: out of range denies", async () => {
  const roomId = "prime_shard:0,0";

  const caster = makeChar({ id: "char_ranged_oob", name: "Archer" });
  const casterSession = makeSession({ id: "sess_ranged_oob", name: "Archer", roomId, userId: "u1", char: caster });

  const selfEnt: AnyEntity = {
    id: "player_archer_ent2",
    type: "player",
    name: "Archer",
    roomId,
    ownerSessionId: casterSession.id,
    hp: 100,
    maxHp: 100,
    x: 0,
    y: 0,
    z: 0,
    rotY: 0,
    tags: [],
  };

  const dummy: AnyEntity = {
    id: "npc_training_dummy",
    type: "npc",
    name: "Training Dummy",
    roomId,
    hp: 20,
    maxHp: 20,
    alive: true,
    x: 0,
    y: 0,
    z: 999,
    tags: [],
  };

  const ctx = makeCtx({ roomId, casterSession, allSessions: [casterSession], entities: [selfEnt, dummy] });

  const line = await handleRangedAttackAction(ctx, caster, "Training Dummy");
  assert.ok(String(line).toLowerCase().includes("out of range"), `Expected out-of-range denial, got: ${line}`);
  assert.equal(dummy.hp, 20);
});

test("[contract] ranged verb: target behind you denies LoS", async () => {
  const roomId = "prime_shard:0,0";

  const caster = makeChar({ id: "char_ranged_los", name: "Archer" });
  const casterSession = makeSession({ id: "sess_ranged_los", name: "Archer", roomId, userId: "u1", char: caster });

  const selfEnt: AnyEntity = {
    id: "player_archer_ent3",
    type: "player",
    name: "Archer",
    roomId,
    ownerSessionId: casterSession.id,
    hp: 100,
    maxHp: 100,
    x: 0,
    y: 0,
    z: 0,
    rotY: 0, // facing +Z
    tags: [],
  };

  const dummy: AnyEntity = {
    id: "npc_training_dummy",
    type: "npc",
    name: "Training Dummy",
    roomId,
    hp: 20,
    maxHp: 20,
    alive: true,
    x: 0,
    y: 0,
    z: -6, // behind
    tags: [],
  };

  const ctx = makeCtx({ roomId, casterSession, allSessions: [casterSession], entities: [selfEnt, dummy] });

  const line = await handleRangedAttackAction(ctx, caster, "Training Dummy");
  assert.ok(String(line).toLowerCase().includes("line of sight"), `Expected LoS denial, got: ${line}`);
  assert.equal(dummy.hp, 20);
});
