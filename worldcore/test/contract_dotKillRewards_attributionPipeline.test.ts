//worldcore/test/contract_dotKillRewards_attributionPipeline.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { SessionManager } from "../core/SessionManager";
import { NpcManager } from "../npc/NpcManager";

// This contract test ensures DOT kills go through the same canonical death
// pipeline as direct attacks: XP + loot are granted, and the route is safe
// to call from the synchronous TickEngine.

test("[contract] DOT kill routes through canonical NPC death pipeline (XP + loot)", async () => {
  // Keep corpse/respawn timers short.
  process.env.WORLDCORE_TEST = "1";
  process.env.PW_DOT_COMBAT_LOG = "0";

  // Deterministic loot rolls.
  const oldRandom = Math.random;
  Math.random = () => 0;

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
        bags: [
          {
            bagId: "main",
            slots: Array.from({ length: 10 }, () => null),
          },
        ],
      },
    };
    session.character = char;

    const roomId = "room.1";
    const room = {
      broadcast: () => {},
    };
    const rooms = new Map<string, any>([[roomId, room]]);

    // Character service + mail stubs used by the death pipeline.
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
    (npcs as any).attachDeathPipelineServices({ rooms, characters, items: undefined, mail });

    const player = entities.createPlayerForSession(session.id, roomId) as any;
    player.ownerSessionId = session.id;

    const rat = npcs.spawnNpcById("town_rat", roomId, 0, 0, 0);
    if (!rat) throw new Error("failed to spawn town_rat");
    const npcEntityId = rat.entityId;

    // Lethal DOT tick
    npcs.applyDotDamage(npcEntityId, 999, { name: "Ignite" }, player.id);

    // Allow async reward pipeline + corpse/respawn timers to finish.
    await new Promise((r) => setTimeout(r, 90));

    assert.equal(char.xp, 8, "DOT kill should grant XP reward from prototype");

    const slots = char.inventory.bags[0].slots as any[];
    const stack = slots.find((s) => s && s.itemId === "rat_tail");
    assert.ok(stack, "DOT kill should deliver loot to bags");
    assert.equal(stack.qty, 1);
  } finally {
    Math.random = oldRandom;
  }
});
