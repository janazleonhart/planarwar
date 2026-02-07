// worldcore/test/contract_taunt_breaks_stealth.test.ts
//
// Contract: taunt is a hostile commit and must break stealth.

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";

import { handleTauntAction } from "../mud/actions/MudCombatActions";
import { getActiveStatusEffects } from "../combat/StatusEffects";

type AnySession = any;
type AnyEntity = any;

function makeChar(id: string): CharacterState {
  const now = new Date();
  return {
    id,
    userId: "u",
    name: "SneakyTaunter",
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
    abilities: { learned: {} },
    progression: { skills: { defense: 0 } },
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
  return { id, roomId, character: char, char };
}

function makeCtx(args: {
  roomId: string;
  session: AnySession;
  allSessions: AnySession[];
  entities: AnyEntity[];
  tauntCalls: any[];
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

  const npcs = {
    taunt: (npcEntityId: string, attackerEntityId: string, opts: any) => {
      args.tauntCalls.push({ npcEntityId, attackerEntityId, opts });
      return true;
    },
  };

  return { session: args.session, sessions, entities, world: {}, npcs };
}

test("[contract] taunt breaks stealth immediately", async () => {
  const roomId = "prime_shard:0,0";

  const char = makeChar("char1");
  addStealth(char as any);

  assert.ok(getActiveStatusEffects(char as any).some((e) => (e.tags ?? []).includes("stealth")));

  const s = makeSession("sess1", roomId, char as any);
  const eSelf: AnyEntity = { id: "ent_self", type: "player", roomId, ownerSessionId: s.id, hp: 100, maxHp: 100, alive: true, name: char.name };
  const eNpc: AnyEntity = { id: "npc1", type: "npc", roomId, alive: true, name: "Rat" };

  const tauntCalls: any[] = [];
  const ctx = makeCtx({ roomId, session: s, allSessions: [s], entities: [eSelf, eNpc], tauntCalls });

  const line = await handleTauntAction(ctx as any, char as any, "rat");
  assert.match(line, /taunt/i);

  assert.equal(getActiveStatusEffects(char as any).some((e) => (e.tags ?? []).includes("stealth")), false);
  assert.equal(tauntCalls.length, 1);
});
