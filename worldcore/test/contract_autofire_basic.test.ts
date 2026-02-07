// worldcore/test/contract_autofire_basic.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { handleAutoFireCommand } from "../mud/commands/combat/autofireCommand";
import { handleRangedAttackAction } from "../mud/actions/MudCombatActions";
import { stopAutoFire } from "../mud/commands/combat/autofire/autofire";
import { getTrainingDummyForRoom } from "../mud/MudTrainingDummy";

// Make cadence deterministic + fast.
process.env.PW_AUTOFIRE_MS = "30";
process.env.PW_RANGED_MAX_RANGE = "14";
process.env.PW_RANGED_FOV_DEG = "180";

type AnyChar = any;
type AnySession = any;
type AnyEntity = any;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeChar(args: { id: string; name: string; shardId?: string }): AnyChar {
  return {
    id: args.id,
    name: args.name,
    classId: "outrider",
    level: 1,
    shardId: args.shardId ?? "prime_shard",
    spellbook: { known: {} },
    progression: {
      powerResources: { mana: { current: 100, max: 100 } },
      cooldowns: {},
      skills: {},
    },
    flags: {},
    statusEffects: {},
    attributes: { str: 10, agi: 10, int: 10, sta: 10, wis: 10, cha: 10 },
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

function makeCtx(args: { roomId: string; casterSession: AnySession; allSessions: AnySession[]; entities: AnyEntity[]; lines: string[] }): any {
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
    send: (_session: any, _evt: string, payload: any) => {
      const text = String(payload?.text ?? "");
      if (text) args.lines.push(text);
    },
  };

  return {
    session: args.casterSession,
    sessions,
    entities,
    npcs: {
      getNpcStateByEntityId: (id: string) => {
        if (String(id) === "npc_training_dummy") return { protoId: "training_dummy_big" };
        return null;
      },
    },
    ignoreServiceProtection: false,
  };
}

test("[contract] autofire: on + engaged target emits periodic ranged shots", async () => {
  const roomId = "prime_shard:0,0";
  const lines: string[] = [];

  const caster = makeChar({ id: "char_af_ok", name: "Archer" });
  const casterSession = makeSession({ id: "sess_af_ok", name: "Archer", roomId, userId: "u1", char: caster });

  const selfEnt: AnyEntity = {
    id: "player_archer_ent_af",
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
    engagedTargetId: "npc_training_dummy",
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

  const ctx = makeCtx({ roomId, casterSession, allSessions: [casterSession], entities: [selfEnt, dummy], lines });

  const state = getTrainingDummyForRoom(roomId);
  const before = state.hp;

  // Sanity: ensure a manual ranged shot works and engages the target.
  const manual = await handleRangedAttackAction(ctx, caster, "Training Dummy");
  assert.ok(String(manual).toLowerCase().includes("you shoot"), `Expected manual shoot line, got: ${manual}`);
  const afterManual = getTrainingDummyForRoom(roomId).hp;
  assert.ok(afterManual < before, "Expected manual shot to reduce dummy HP pool");

  const startMsg = await handleAutoFireCommand(ctx, caster, { cmd: "autofire", args: ["on"], parts: ["autofire", "on"] });
  assert.ok(String(startMsg).toLowerCase().includes("enabled"), `Expected enabled message, got: ${startMsg}`);

  await sleep(110);
  stopAutoFire(ctx);

  const after = getTrainingDummyForRoom(roomId).hp;
  assert.ok(after < afterManual, "Expected dummy HP pool to decrease under autofire");
  assert.ok(lines.some((l) => l.toLowerCase().includes("(auto)")), "Expected an (auto) combat line");
});

test("[contract] autofire: off stops further shots", async () => {
  const roomId = "prime_shard:0,1";
  const lines: string[] = [];

  const caster = makeChar({ id: "char_af_off", name: "Archer" });
  const casterSession = makeSession({ id: "sess_af_off", name: "Archer", roomId, userId: "u1", char: caster });

  const selfEnt: AnyEntity = {
    id: "player_archer_ent_af2",
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
    engagedTargetId: "npc_training_dummy",
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

  const ctx = makeCtx({ roomId, casterSession, allSessions: [casterSession], entities: [selfEnt, dummy], lines });

  await handleAutoFireCommand(ctx, caster, { cmd: "autofire", args: ["on"], parts: ["autofire", "on"] });
  await sleep(80);
  await handleAutoFireCommand(ctx, caster, { cmd: "autofire", args: ["off"], parts: ["autofire", "off"] });

  const hpAfterStop = getTrainingDummyForRoom(roomId).hp;
  await sleep(90);

  const hpFinal = getTrainingDummyForRoom(roomId).hp;
  assert.equal(hpFinal, hpAfterStop, "Expected no further dummy damage after autofire off");
});

test("[contract] autofire: no engaged target does nothing (no spam)", async () => {
  const roomId = "prime_shard:0,2";
  const lines: string[] = [];

  const caster = makeChar({ id: "char_af_none", name: "Archer" });
  const casterSession = makeSession({ id: "sess_af_none", name: "Archer", roomId, userId: "u1", char: caster });

  const selfEnt: AnyEntity = {
    id: "player_archer_ent_af3",
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

  const ctx = makeCtx({ roomId, casterSession, allSessions: [casterSession], entities: [selfEnt, dummy], lines });

  const state = getTrainingDummyForRoom(roomId);
  const before = state.hp;

  await handleAutoFireCommand(ctx, caster, { cmd: "autofire", args: ["on"], parts: ["autofire", "on"] });
  await sleep(100);
  stopAutoFire(ctx);

  const after = getTrainingDummyForRoom(roomId).hp;
  assert.equal(after, before, "Expected no damage without engaged target");
  assert.equal(lines.length, 0, "Expected no spammy autofire lines without engaged target");
});
