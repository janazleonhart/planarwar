// worldcore/test/contract_dotTick_absorbAware.test.ts
//
// Contract: DOT tick lines must be absorb-aware (truthful damage + absorbed suffix)
// when shields consume some or all tick damage.
//

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { SessionManager } from "../core/SessionManager";
import { RoomManager } from "../core/RoomManager";
import { ServerWorldManager } from "../world/ServerWorldManager";
import { TickEngine } from "../core/TickEngine";
import { NpcManager } from "../npc/NpcManager";
import { applyStatusEffectToEntity } from "../combat/StatusEffects";

function makeCaptureSocket() {
  const sent: any[] = [];
  return {
    sent,
    sock: {
      send: (msg: any) => {
        try {
          sent.push(typeof msg === "string" ? msg : JSON.stringify(msg));
        } catch {
          sent.push(String(msg));
        }
      },
      close: () => {},
    },
  };
}

test("[contract] DOT tick combat line uses effective damage and absorbed suffix", async () => {
  process.env.WORLDCORE_TEST = "1";
  process.env.PW_DOT_TICK_MESSAGES = "1";
  process.env.PW_DOT_COMBAT_LOG = "0";

  const entities = new EntityManager();
  const sessions = new SessionManager();

  const cap = makeCaptureSocket();
  const session: any = sessions.createSession(cap.sock as any, "shard.1");
  session.identity = { userId: "U1" };

  const char: any = { id: "C1", name: "Tester", level: 1, xp: 0, inventory: { gold: 0, bags: [{ bagId: "main", slots: [] }] } };
  session.character = char;

  const roomId = "room.1";
  const npcs = new NpcManager(entities, sessions);

  const player = entities.createPlayerForSession(session.id, roomId) as any;
  player.ownerSessionId = session.id;

  const rat = npcs.spawnNpcById("town_rat", roomId, 0, 0, 0);
  assert.ok(rat, "npc spawn");
  const npcEnt: any = entities.get(rat!.entityId);

  const now0 = Date.now();

  // Add a small shield (absorb 5) to the NPC.
  applyStatusEffectToEntity(
    npcEnt,
    {
      id: "shield_test_absorb5",
      sourceKind: "spell",
      sourceId: "test_shield",
      name: "Test Shield",
      durationMs: 10_000,
      modifiers: {},
      absorb: { amount: 5 },
      appliedByKind: "character",
      appliedById: char.id,
    },
    now0,
  );

  // Add a DOT ticking for 5 (fully absorbed).
  applyStatusEffectToEntity(
    npcEnt,
    {
      id: "dot_test_5",
      sourceKind: "spell",
      sourceId: "test_dot",
      name: "Test DOT",
      durationMs: 5_000,
      modifiers: {},
      dot: { tickIntervalMs: 1, perTickDamage: 5, damageSchool: "pure" },
      appliedByKind: "character",
      appliedById: char.id,
    },
    now0,
  );

  const roomsMgr = new RoomManager(sessions, entities);
  const world = new ServerWorldManager(0xabc);
  const tick = new TickEngine(entities, roomsMgr, sessions, world, { intervalMs: 50 }, npcs);

  (tick as any).tickNpcStatusDots(now0 + 10);

  const payloads = cap.sent.join("\n");
  assert.ok(payloads.includes("[world] [spell:Test DOT]"), "expected DOT tick line");
  assert.ok(payloads.includes("deals 0 damage"), "fully absorbed tick should deal 0 damage");
  assert.ok(payloads.includes("(5 absorbed)"), "expected absorbed suffix");
});
