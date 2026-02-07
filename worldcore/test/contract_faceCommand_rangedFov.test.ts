// worldcore/test/contract_faceCommand_rangedFov.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { handleRangedAttackAction } from "../mud/actions/MudCombatActions";
import { handleFaceCommand } from "../mud/commands/world/faceCommand";
import { getTrainingDummyForRoom } from "../mud/MudTrainingDummy";

process.env.PW_RANGED_MAX_RANGE = "14";
process.env.PW_RANGED_FOV_DEG = "90";

type AnyChar = any;
type AnySession = any;
type AnyEntity = any;

function makeChar(args: { id: string; name: string; classId?: string; level?: number; shardId?: string }): AnyChar {
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
      powerResources: { mana: { current: 100, max: 100 } },
      cooldowns: {},
      skills: {},
    },
    flags: {},
    statusEffects: {},
    attributes: { str: 10, agi: 10, int: 10, sta: 10, wis: 10, cha: 10 },
    rotY: 0,
  };
}

function makeSession(args: { id: string; name: string; roomId: string; userId: string; char: AnyChar }): AnySession {
  return { id: args.id, name: args.name, roomId: args.roomId, userId: args.userId, character: args.char, char: args.char };
}

function makeCtx(args: { casterSession: AnySession; allSessions: AnySession[]; entities: AnyEntity[] }): any {
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
      // no-op
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

test("[contract] face: with narrow FOV, facing target enables ranged hit", async () => {
  const roomId = "prime_shard:0,0";

  const caster = makeChar({ id: "char_face_1", name: "Archer" });
  const casterSession = makeSession({ id: "sess_face_1", name: "Archer", roomId, userId: "u1", char: caster });

  const selfEnt: AnyEntity = {
    id: "player_archer_face_ent",
    type: "player",
    name: "Archer",
    roomId,
    ownerSessionId: casterSession.id,
    hp: 100,
    maxHp: 100,
    x: 0,
    y: 0,
    z: 0,
    rotY: 0, // facing +Z (north)
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
    z: -6, // behind the player initially
    tags: [],
  };

  const ctx = makeCtx({ casterSession, allSessions: [casterSession], entities: [selfEnt, dummy] });

  const state = getTrainingDummyForRoom(roomId);
  const before = state.hp;

  const deny = await handleRangedAttackAction(ctx, caster, "Training Dummy");
  const denyLower = String(deny).toLowerCase();
  assert.ok(
    denyLower.includes("must face") || denyLower.includes("line of sight"),
    `Expected facing/LoS denial, got: ${deny}`,
  );

  const faceLine = await handleFaceCommand(ctx, caster, { cmd: "face", args: ["Training Dummy"], parts: ["face", "Training Dummy"] });
  assert.ok(String(faceLine).toLowerCase().includes("you face"), `Expected face confirmation, got: ${faceLine}`);

  const hit = await handleRangedAttackAction(ctx, caster, "Training Dummy");
  assert.ok(String(hit).includes("You"), `Expected hit line after facing, got: ${hit}`);

  const after = getTrainingDummyForRoom(roomId).hp;
  assert.ok(after < before, "Expected dummy HP pool to decrease after facing + ranged hit");
});
