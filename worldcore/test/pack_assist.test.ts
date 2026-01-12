import test, { after } from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { SessionManager } from "../core/SessionManager";
import { NpcManager } from "../npc/NpcManager";
import type { CharacterState } from "../characters/CharacterTypes";

const ROOM_ID = "pack-room";

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

function createCharacter(id = "char-pack"): CharacterState {
  const now = new Date();
  return {
    id,
    userId: "user-pack",
    shardId: "prime_shard",
    name: "Pack Attacker",
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

test("pack allies assist when one is attacked", () => {
  const entities = new EntityManager();
  const sessions = new SessionManager();
  const npcManager = new NpcManager(entities);

  const socket = { send: () => {}, close: () => {}, readyState: 1 } as any;
  const session = sessions.createSession(socket, "pack-tester");
  session.roomId = ROOM_ID;
  const character = createCharacter();
  session.character = character;
  const player = entities.createPlayerForSession(session.id, ROOM_ID);

  const primary = npcManager.spawnNpcById("rat_pack_raider", ROOM_ID, 0, 0, 0);
  const ally = npcManager.spawnNpcById("rat_pack_raider", ROOM_ID, 1, 0, 0);
  assert.ok(primary && ally, "pack members should spawn");

  npcManager.applyDamage(primary!.entityId, 20, { character, entityId: player.id });
  npcManager.recordDamage(primary!.entityId, player.id);

  npcManager.updateAll(200, sessions);

  assert.equal(
    npcManager.getLastAttacker(ally!.entityId),
    player.id,
    "ally should track attacker as threat",
  );
  assert.ok(player.hp < 100, "ally should engage and damage the attacker");
});
