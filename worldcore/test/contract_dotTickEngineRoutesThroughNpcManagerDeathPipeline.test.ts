//worldcore/test/contract_dotTickEngineRoutesThroughNpcManagerDeathPipeline.test.ts
//
// Contract: DOT ticks processed by TickEngine must route through NpcManager.applyDotDamage
// so lethal ticks award XP/loot and use the canonical death pipeline (corpse/respawn).
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

test("[contract] TickEngine DOT kill routes through NpcManager death pipeline (XP + loot)", async () => {
  process.env.WORLDCORE_TEST = "1";
  process.env.PW_DOT_TICK_MESSAGES = "0";
  process.env.PW_DOT_COMBAT_LOG = "0";

  const oldRandom = Math.random;
  Math.random = () => 0; // deterministic loot rolls

  try {
    const entities = new EntityManager();
    const sessions = new SessionManager();

    // Minimal socket stub
    const sock: any = { send: () => {}, close: () => {} };
    const session: any = sessions.createSession(sock, "shard.1");
    session.identity = { userId: "U1" };

    const char: any = {
      id: "C1",
      name: "Tester",
      level: 1,
      xp: 0,
      inventory: {
        gold: 0,
        bags: [{ bagId: "main", slots: Array.from({ length: 10 }, () => null) }],
      },
    };
    session.character = char;

    const roomId = "room.1";
    const room = { broadcast: () => {} };
    const roomsMap = new Map<string, any>([[roomId, room]]);

    // Death pipeline services
    const characters = {
      async grantXp(_userId: string, _charId: string, amount: number) {
        char.xp = (char.xp ?? 0) + amount;
        return char;
      },
      async saveCharacter(_c: any) {
        return;
      },
    };
    const mail = {
      async sendSystemMail(_opts: any) {
        // Should not be called in this test (bags have space).
      },
    };

    const npcs = new NpcManager(entities, sessions);
    (npcs as any).attachDeathPipelineServices({ rooms: roomsMap, characters, items: undefined, mail });

    // Create player + NPC entities
    const player = entities.createPlayerForSession(session.id, roomId) as any;
    player.ownerSessionId = session.id;

    const rat = npcs.spawnNpcById("town_rat", roomId, 0, 0, 0);
    if (!rat) throw new Error("failed to spawn town_rat");
    const npcEnt: any = entities.get(rat.entityId);

    // Apply a lethal DOT directly onto the NPC entity (as spells would).
    const now0 = Date.now();
    applyStatusEffectToEntity(
      npcEnt,
      {
        id: "dot_archmage_ignite",
        sourceKind: "spell",
        sourceId: "archmage_ignite",
        name: "Ignite",
        durationMs: 3000,
        modifiers: {},
        dot: { tickIntervalMs: 1, perTickDamage: 9999, damageSchool: "pure" },
        // Intentionally omit stackingPolicy and versionKey: DOT defaults must be safe.
        appliedByKind: "character",
        appliedById: char.id,
      },
      now0,
    );

    // Tick via TickEngine private helper (contract tests may call private methods).
    const roomsMgr = new RoomManager(sessions, entities);
    const world = new ServerWorldManager(0xabc);
    const tick = new TickEngine(entities, roomsMgr, sessions, world, { intervalMs: 50 }, npcs);

    (tick as any).tickNpcStatusDots(now0 + 10);

    // Allow async reward pipeline + corpse/respawn timers to finish.
    await new Promise((r) => setTimeout(r, 120));

    assert.equal(char.xp, 8, "DOT tick kill should grant XP reward from prototype");

    const slots = char.inventory.bags[0].slots as any[];
    const stack = slots.find((s) => s && s.itemId === "rat_tail");
    assert.ok(stack, "DOT tick kill should deliver loot to bags");
    assert.equal(stack.qty, 1);
  } finally {
    Math.random = oldRandom;
  }
});
