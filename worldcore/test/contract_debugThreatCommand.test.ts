// worldcore/test/contract_debugThreatCommand.test.ts
//
// [contract] debug_threat reports NPC threat table and top target deterministically.
//
// We keep this test lightweight: it stubs only the minimal ctx/entities/npcs surface
// needed to exercise the command output.

import test from "node:test";
import assert from "node:assert/strict";

import { handleDebugThreat } from "../mud/commands/debug/debugThreatCommand";

function makeCtx() {
  const roomId = "prime:0,0";
  const npc = { id: "npc-1", type: "npc", name: "Angry Rat", roomId };
  const player = { id: "player-1", type: "player", name: "Rimuru", roomId };

  const entitiesInRoom = [npc, player];

  const ctx: any = {
    session: { id: "sess-1", roomId },
    entities: {
      getEntitiesInRoom: (_roomId: string) => entitiesInRoom,
      getEntityByOwner: (_owner: string) => player,
      resolveHandle: (handle: string) => {
        if (handle === npc.id) return npc;
        if (handle === player.id) return player;
        return null;
      },
    },
    npcs: {
      getThreatState: (entityId: string) => {
        if (entityId !== npc.id) return undefined;
        return {
          lastAttackerEntityId: player.id,
          lastAggroAt: 123,
          threatByEntityId: { [player.id]: 10 },
        };
      },
    },
  };

  return { ctx, npc, player };
}

test("[contract] debug_threat: dumps threat rows for one NPC", async () => {
  const { ctx, npc, player } = makeCtx();

  const out = await handleDebugThreat(ctx, null, { cmd: "debug_threat", args: [npc.id], parts: ["debug_threat", npc.id] });

  assert.ok(out.includes("Angry Rat"), "should include NPC name");
  assert.ok(out.includes(player.id.slice(0, 8)), "should include attacker id short");
  assert.ok(out.includes("table:"), "should include table header");
});
