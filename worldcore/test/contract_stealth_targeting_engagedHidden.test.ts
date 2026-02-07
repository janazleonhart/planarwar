// worldcore/test/contract_stealth_targeting_engagedHidden.test.ts
//
// Contract: stealth hides a player from hostile targeting + clears engaged targets.
// This prevents "free tracking" and stops threat/assist leakage via auto-attacks.

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";

import { handleRangedAttackAction } from "../mud/actions/MudCombatActions";

type AnySession = any;
type AnyEntity = any;

function makeChar(id: string, name: string, classId: string): CharacterState {
  const now = new Date();
  return {
    id,
    userId: "u",
    name,
    shardId: "prime_shard",
    classId,
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
    abilities: { learned: {} },
    progression: { skills: { weapons: { bow: 25 }, defense: 0 } },
    stateVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function addStealth(char: any) {
  char.progression = char.progression ?? {};
  char.progression.statusEffects = char.progression.statusEffects ?? {};
  const se = char.progression.statusEffects;
  se.active = se.active ?? {};
  se.active["test_stealth"] = {
    id: "test_stealth",
    name: "Stealth",
    durationMs: 60_000,
    appliedAt: Date.now(),
    tags: ["stealth"],
  };
}

function makeSession(id: string, roomId: string, char: AnySession): AnySession {
  return {
    id,
    roomId,
    userId: "u",
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
    get: (id: string) => args.entities.find((e) => String((e as any).id ?? "") === String(id)) ?? null,
  };

  const sessions = {
    getAllSessions: () => args.allSessions,
    get: (id: string) => sessionsById.get(String(id)) ?? null,
    send: () => {},
  };

  return {
    session: args.session,
    sessions,
    entities,
    world: {},
    items: {},
    // minimal PvP policy: allow by default for the contract (damage still applied through gate plumbing)
    npcs: undefined,
  };
}

test("[contract] stealth hides engaged player target from ranged autofire/attack selection", async () => {
  const roomId = "prime_shard:0,0";

  const attacker = makeChar("char_attacker", "Attacker", "outrider");
  const target = makeChar("char_target", "Sneaky", "cutthroat");
  addStealth(target as any);

  const sA = makeSession("sess_a", roomId, attacker as any);
  const sB = makeSession("sess_b", roomId, target as any);

  const eA: AnyEntity = { id: "ent_a", type: "player", roomId, ownerSessionId: sA.id, hp: 100, maxHp: 100, alive: true, name: attacker.name };
  const eB: AnyEntity = { id: "ent_b", type: "player", roomId, ownerSessionId: sB.id, hp: 100, maxHp: 100, alive: true, name: target.name };

  // Pretend attacker is engaged with target (no-arg attack path).
  eA.engagedTargetId = eB.id;

  const ctx = makeCtx({ roomId, session: sA, allSessions: [sA, sB], entities: [eA, eB] });

  const before = eB.hp;
  const line = await handleRangedAttackAction(ctx as any, attacker as any, "");
  assert.match(line, /cannot see/i);

  // Engaged target should be cleared and no damage dealt.
  assert.equal((eA as any).engagedTargetId ?? null, null);
  assert.equal(eB.hp, before);
});
