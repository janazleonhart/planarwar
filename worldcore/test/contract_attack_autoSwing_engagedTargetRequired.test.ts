// worldcore/test/contract_attack_autoSwing_engagedTargetRequired.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { handleAttackCommand } from "../mud/commands/combat/attackCommand";

import type { CharacterState } from "../characters/CharacterTypes";

type AnySession = any;

type AnyEntity = any;

function dummyChar(id: string): CharacterState {
  const now = new Date();

  return {
    id,
    userId: "user-test",
    name: "Tester",
    shardId: "prime_shard",
    classId: "warrior",
    level: 1,
    xp: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    lastRegionId: null,
    appearanceTag: null,
    attributes: { str: 10, agi: 10, int: 10, sta: 10, wis: 10, cha: 10 },
    inventory: { bags: [], currency: {} },
    equipment: {},
    spellbook: { known: {} },
    abilities: {},
    progression: {},
    stateVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function makeSession(id: string, roomId: string, char: AnySession): AnySession {
  return {
    id,
    roomId,
    userId: "u1",
    name: char?.name ?? "Tester",
    character: char,
    char,
  };
}

function makeCtx(args: {
  roomId: string;
  session: AnySession;
  allSessions: AnySession[];
  entities: AnyEntity[];
}): any {
  const sessionsById = new Map<string, AnySession>();
  for (const s of args.allSessions) sessionsById.set(String(s.id), s);

  const entities = {
    getAll: () => args.entities,
    getEntitiesInRoom: (roomId: string) => args.entities.filter((e) => String(e.roomId ?? "") === String(roomId)),
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
    session: args.session,
    sessions,
    entities,
    world: {},
  };
}

test("[contract] attack: auto-swing requires an engaged target (deny-by-default)", async () => {
  const roomId = "prime_shard:0,0";

  const char = dummyChar("char_auto_denied");
  const session = makeSession("sess_auto_denied", roomId, char as any);

  const self: AnyEntity = {
    id: "player_auto_denied",
    type: "player",
    roomId,
    ownerSessionId: session.id,
    hp: 100,
    maxHp: 100,
    alive: true,
    name: "Tester",
  };

  const ratA: AnyEntity = {
    id: "npc_rat_a",
    type: "npc",
    roomId,
    hp: 50,
    maxHp: 50,
    alive: true,
    name: "Rat",
    tags: [],
  };

  const ratB: AnyEntity = {
    id: "npc_rat_b",
    type: "npc",
    roomId,
    hp: 50,
    maxHp: 50,
    alive: true,
    name: "Rat",
    tags: [],
  };

  const ctx = makeCtx({
    roomId,
    session,
    allSessions: [session],
    entities: [self, ratA, ratB],
  });

  const out = await handleAttackCommand(ctx, char as any, {
    cmd: "attack",
    args: [],
    parts: ["attack"],
  });

  assert.ok(String(out).toLowerCase().includes("not engaged"), `expected denial, got: ${out}`);
  assert.equal(ratA.hp, 50);
  assert.equal(ratB.hp, 50);
});

test("[contract] attack: auto-swing hits ONLY your engaged target", async () => {
  const roomId = "prime_shard:0,0";

  const char = dummyChar("char_auto_engaged");
  const session = makeSession("sess_auto_engaged", roomId, char as any);

  const self: AnyEntity = {
    id: "player_auto_engaged",
    type: "player",
    roomId,
    ownerSessionId: session.id,
    hp: 100,
    maxHp: 100,
    alive: true,
    name: "Tester",
  };

  const ratA: AnyEntity = {
    id: "npc_rat_a2",
    type: "npc",
    roomId,
    hp: 80,
    maxHp: 80,
    alive: true,
    name: "Rat",
    tags: [],
  };

  const ratB: AnyEntity = {
    id: "npc_rat_b2",
    type: "npc",
    roomId,
    hp: 80,
    maxHp: 80,
    alive: true,
    name: "Rat",
    tags: [],
  };

  const ctx = makeCtx({
    roomId,
    session,
    allSessions: [session],
    entities: [self, ratA, ratB],
  });

  // Engage Rat A explicitly (use entity id to avoid name ambiguity).
  const out1 = await handleAttackCommand(ctx, char as any, {
    cmd: "attack",
    args: [ratA.id],
    parts: ["attack", ratA.id],
  });

  assert.ok(String(out1).toLowerCase().includes("you hit") || String(out1).toLowerCase().includes("[combat]"), `expected a combat line, got: ${out1}`);
  assert.equal(String((self as any).engagedTargetId), ratA.id, "should set engagedTargetId to the attacked entity");

  const ratA_after1 = ratA.hp;
  const ratB_after1 = ratB.hp;

  assert.ok(ratA_after1 < 80, "expected engaged target to take damage");
  assert.equal(ratB_after1, 80, "non-engaged target must not take damage");

  // Auto-swing (no args) should hit ONLY Rat A again.
  const out2 = await handleAttackCommand(ctx, char as any, {
    cmd: "attack",
    args: [],
    parts: ["attack"],
  });

  assert.ok(String(out2).toLowerCase().includes("you hit") || String(out2).toLowerCase().includes("[combat]"), `expected a combat line, got: ${out2}`);

  assert.ok(ratA.hp < ratA_after1, "expected engaged target to take another hit");
  assert.equal(ratB.hp, ratB_after1, "non-engaged target must remain unchanged");
});
