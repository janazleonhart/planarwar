// worldcore/test/contract_ranged_verbs_targeting.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { handleRangedAttackAction } from "../mud/actions/MudCombatActions";
import { getTrainingDummyForRoom } from "../mud/MudTrainingDummy";

// NOTE: Set PW_RANGED_* per-test to avoid env leakage from other suites.

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
    // Baseline attributes are important for deterministic training dummy damage.
    attributes: {
      str: 10,
      agi: 10,
      sta: 10,
      int: 10,
      spi: 10,
    },
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

  // Provide an empty blueprint so LoS checks are deterministic and don't default-deny.
  const world = {
    getWorldBlueprintForRoom: (_roomId: string) => ({ objects: [] as any[] }),
  };

  return {
    session: args.casterSession,
    sessions,
    entities,
    world,
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
  process.env.PW_RANGED_MAX_RANGE = "14";
  // Keep success path independent of facing rules.
  process.env.PW_RANGED_FOV_DEG = "360";

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
    z: 6,
    tags: [],
  };

  const ctx = makeCtx({ roomId, casterSession, allSessions: [casterSession], entities: [selfEnt, dummy] });

  const before = getTrainingDummyForRoom(roomId).hp;
  const line = await handleRangedAttackAction(ctx, caster, "Training Dummy");

  // Be stricter than "includes('You')" because deny lines also contain "You".
  // Accept either classic "hit" phrasing or the newer "shoot ... for X damage" phrasing.
  const lower = String(line).toLowerCase();
  const looksLikeHit = lower.includes(" hit ") || lower.includes(" you hit ");
  const looksLikeShoot = lower.includes("you shoot") && lower.includes(" damage");
  assert.ok(looksLikeHit || looksLikeShoot, `Expected a successful damage line, got: ${line}`);

  const after = getTrainingDummyForRoom(roomId).hp;
  assert.ok(after < before, `Expected dummy HP pool to decrease (before=${before}, after=${after}).`);
});

test("[contract] ranged verb: out of range denies", async () => {
  process.env.PW_RANGED_MAX_RANGE = "14";
  process.env.PW_RANGED_FOV_DEG = "360";

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
  process.env.PW_RANGED_MAX_RANGE = "14";
  // Narrow cone so "behind" is meaningful.
  process.env.PW_RANGED_FOV_DEG = "90";

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
    z: -6,
    tags: [],
  };

  const ctx = makeCtx({ roomId, casterSession, allSessions: [casterSession], entities: [selfEnt, dummy] });

  const line = await handleRangedAttackAction(ctx, caster, "Training Dummy");
  const lower = String(line).toLowerCase();
  assert.ok(lower.includes("must face") || lower.includes("line of sight"), `Expected facing/LoS denial, got: ${line}`);
  assert.equal(dummy.hp, 20);
});
