import test, { after } from "node:test";
import assert from "node:assert/strict";
import { EntityManager } from "../core/EntityManager";
import { SessionManager } from "../core/SessionManager";
import { NpcManager } from "../npc/NpcManager";
import type { CharacterState } from "../characters/CharacterTypes";
import type { LocalSimpleAggroBrain } from "../ai/LocalSimpleNpcBrain";

const ROOM_ID = "guard-room";

after(() => {
  const handles = (process as any)._getActiveHandles?.() ?? [];
  const requests = (process as any)._getActiveRequests?.() ?? [];

  const summarize = (x: any) => {
    const name = x?.constructor?.name ?? typeof x;
    // some handles have extra hints
    const fd = (x as any)?.fd;
    const hasRef = typeof (x as any)?.hasRef === "function" ? (x as any).hasRef() : undefined;
    return { name, fd, hasRef };
  };

  console.error("\n[TEST DEBUG] Active handles:", handles.map(summarize));
  console.error("[TEST DEBUG] Active requests:", requests.map(summarize));
});

function createCharacter(classId: string, id = "char-1"): CharacterState {
  const now = new Date();
  return {
    id,
    userId: "user-1",
    shardId: "prime_shard",
    name: "Criminal",
    classId,
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

function setupWorld(classId: string = "virtuoso") {
  const entities = new EntityManager();
  const sessions = new SessionManager();
  const npcManager = new NpcManager(entities);
  const socket = { send: () => {}, close: () => {}, readyState: 1 } as any;
  const session = sessions.createSession(socket, "tester");
  session.roomId = ROOM_ID;
  const character = createCharacter(classId);
  session.character = character;
  const player = entities.createPlayerForSession(session.id, ROOM_ID);
  return { entities, sessions, npcManager, session, character, player };
}

function getBrain(npcManager: NpcManager): LocalSimpleAggroBrain {
  return (npcManager as any).brain as LocalSimpleAggroBrain;
}

test("guard warns after minor crime in a safe hub", () => {
  const { entities, sessions, npcManager, character, player } = setupWorld();

  const guard = npcManager.spawnNpcById("town_guard", ROOM_ID, 0, 0, 0);
  const civilian = npcManager.spawnNpcById("training_dummy", ROOM_ID, 1, 0, 0);
  assert.ok(guard && civilian, "should spawn guard and civilian");

  npcManager.applyDamage(civilian!.entityId, 5, { character });

  assert.ok(character.recentCrimeUntil && character.recentCrimeUntil > Date.now());
  assert.equal(character.recentCrimeSeverity, "minor");

  npcManager.updateAll(250, sessions);

  const brain = getBrain(npcManager);
  assert.equal(player.hp, 100, "guard should not attack immediately on minor crime");
  assert.ok(
    brain.hasWarnedTarget(guard!.entityId, character.id),
    "guard should have issued a warning",
  );
});

test("guard attacks after lethal crime", () => {
  const { entities, sessions, npcManager, character, player } = setupWorld("templar");

  const guard = npcManager.spawnNpcById("town_guard", ROOM_ID, 0, 0, 0);
  const civilian = npcManager.spawnNpcById("training_dummy", ROOM_ID, 1, 0, 0);
  assert.ok(guard && civilian, "should spawn guard and civilian");

  npcManager.applyDamage(civilian!.entityId, 500, { character });

  assert.equal(character.recentCrimeSeverity, "severe");

  npcManager.updateAll(250, sessions);

  assert.ok(player.hp < 100, "guard should engage and damage the offender");
});
