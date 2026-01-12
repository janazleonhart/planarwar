import test, { after } from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { SessionManager } from "../core/SessionManager";
import { NpcManager } from "../npc/NpcManager";
import type { CharacterState } from "../characters/CharacterTypes";

const FIGHT_ROOM = "bandit-fight";
const HOME_ROOM = "bandit-home";

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

function createCharacter(id = "char-bandit"): CharacterState {
  const now = new Date();
  return {
    id,
    userId: "user-bandit",
    shardId: "prime_shard",
    name: "Bandit Target",
    classId: "virtuoso",
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

test("bandit can gate home and call allies", () => {
  const entities = new EntityManager();
  const sessions = new SessionManager();
  const npcManager = new NpcManager(entities);
  const socket = { send: () => {}, close: () => {}, readyState: 1 } as any;
  const session = sessions.createSession(socket, "bandit-tester");
  session.roomId = FIGHT_ROOM;
  const character = createCharacter();
  session.character = character;
  const player = entities.createPlayerForSession(session.id, FIGHT_ROOM);

  const bandit = npcManager.spawnNpcById("bandit_caster", HOME_ROOM, 0, 0, 0);
  assert.ok(bandit, "bandit should spawn at home");
  // move bandit into the fight room for the encounter
  (npcManager as any).moveNpcToRoom(bandit!, bandit!.entityId, FIGHT_ROOM);

  const ally = npcManager.spawnNpcById("bandit_caster", HOME_ROOM, 1, 0, 0);
  assert.ok(ally, "ally should spawn at home");

  const originalRandom = Math.random;
  Math.random = () => 0; // force gate attempt

  npcManager.applyDamage(bandit!.entityId, 140, { character, entityId: player.id });
  npcManager.recordDamage(bandit!.entityId, player.id);

  npcManager.updateAll(200, sessions);

  Math.random = originalRandom;

  const fightNpcs = npcManager.listNpcsInRoom(FIGHT_ROOM);
  const allyState = fightNpcs.find((n) => n.entityId === ally!.entityId);
  assert.ok(allyState, "ally should snap toward the fight after a gate call");
  assert.equal(
    npcManager.getLastAttacker(ally!.entityId),
    player.id,
    "ally should have threat on attacker",
  );
  assert.ok(
    fightNpcs.some((n) => n.templateId === "bandit_caster"),
    "bandit or allies should snap into fight room to engage",
  );
});
