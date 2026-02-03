// worldcore/test/contract_cutthroatStealth_pickpocket_mug.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";

import { handleAbilityCommand } from "../mud/MudAbilities";
import { getActiveStatusEffects } from "../combat/StatusEffects";
import { getGold } from "../items/InventoryHelpers";

type AnySession = any;
type AnyEntity = any;

function withFixedRandom<T>(value: number, fn: () => T): T {
  const old = Math.random;
  (Math as any).random = () => value;
  try {
    return fn();
  } finally {
    (Math as any).random = old;
  }
}

function dummyCutthroat(id: string): CharacterState {
  const now = new Date();
  return {
    id,
    userId: "user-test",
    name: "Tester",
    shardId: "prime_shard",
    classId: "cutthroat",
    level: 5,
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
    abilities: {
      learned: {
        cutthroat_stealth: true,
        cutthroat_pickpocket: true,
        cutthroat_backstab: true,
        cutthroat_mug: true,
      },
    },
    progression: { skills: { weapons: { dagger: 25 }, defense: 0 } },
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

function isStealthed(char: CharacterState): boolean {
  return getActiveStatusEffects(char as any).some((e) => (e?.tags ?? []).includes("stealth"));
}

test("[contract] cutthroat stealth toggles, and stealth-gated abilities deny before cost/cooldown", async () => {
  const roomId = "prime_shard:0,0";

  const char = dummyCutthroat("char_cutthroat");
  const session = makeSession("sess_cutthroat", roomId, char as any);

  const self: AnyEntity = {
    id: "player_cutthroat",
    type: "player",
    roomId,
    ownerSessionId: session.id,
    hp: 100,
    maxHp: 100,
    alive: true,
    name: "Tester",
  };

  const rat: AnyEntity = {
    id: "npc_rat_steal",
    type: "npc",
    roomId,
    hp: 50,
    maxHp: 50,
    alive: true,
    name: "Rat",
    level: 1,
    tags: [],
  };

  const ctx = makeCtx({
    roomId,
    session,
    allSessions: [session],
    entities: [self, rat],
  });

  // Pickpocket should deny when not stealthed.
  const deny = await handleAbilityCommand(ctx, char as any, "cutthroat_pickpocket", rat.id);
  assert.ok(String(deny).toLowerCase().includes("stealth"), `expected stealth denial, got: ${deny}`);
  assert.equal(getGold((char as any).inventory), 0);

  // Enter stealth.
  const stealthOut = await handleAbilityCommand(ctx, char as any, "cutthroat_stealth");
  assert.ok(String(stealthOut).toLowerCase().includes("shadows"), `expected stealth line, got: ${stealthOut}`);
  assert.equal(isStealthed(char), true);

  // Pickpocket succeeds deterministically (roll=0.0) and breaks stealth.
  const pick = await withFixedRandom(0.0, () => handleAbilityCommand(ctx, char as any, "cutthroat_pickpocket", rat.id));
  assert.ok(String(pick).toLowerCase().includes("pickpocket"), `expected pickpocket line, got: ${pick}`);
  assert.equal(getGold((char as any).inventory), 1);
  assert.equal(isStealthed(char), false, "pickpocket should break stealth");

  // Re-enter stealth and mug: does damage + steals (roll=0.5, amount=2).
  await handleAbilityCommand(ctx, char as any, "cutthroat_stealth");
  assert.equal(isStealthed(char), true);

  const mugOut = await withFixedRandom(0.5, () => handleAbilityCommand(ctx, char as any, "cutthroat_mug", rat.id));
  assert.ok(String(mugOut).toLowerCase().includes("mug") || String(mugOut).toLowerCase().includes("you hit"), `expected mug output, got: ${mugOut}`);
  assert.ok(rat.hp < 50, "mug should deal damage");
  assert.equal(getGold((char as any).inventory), 3, "mug should add 2 more gold (total 3)");
  assert.equal(isStealthed(char), false, "mug should break stealth");
});
