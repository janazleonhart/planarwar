// worldcore/test/contract_debugThreat_watch_set.test.ts
//
// [contract] debug_threat supports --watch and dev-only mutation helpers (--set/--add/--clear/--force)
// without throwing, and mutates the backing threat state deterministically.

import test from "node:test";
import assert from "node:assert/strict";

import { handleDebugThreat } from "../mud/commands/debug/debugThreatCommand";

function makeCtx() {
  const roomId = "prime:0,0";
  const npc = { id: "npc-1", type: "npc", name: "Angry Rat", roomId };
  const player = { id: "player-1", type: "player", name: "Rimuru", roomId };

  const entitiesInRoom = [npc, player];

  const threatByNpcId = new Map<string, any>();
  threatByNpcId.set(npc.id, {
    lastAttackerEntityId: player.id,
    lastAggroAt: 123,
    threatByEntityId: { [player.id]: 10 },
  });

  const sent: string[] = [];
  const session = { id: "sess-1", roomId, character: { id: "char-1" } };

  const ctx: any = {
    session,
    sessions: {
      get: (id: string) => (id === session.id ? session : null),
      send: (_session: any, _kind: string, payload: any) => {
        if (payload?.text) sent.push(String(payload.text));
      },
    },
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
      getThreatState: (entityId: string) => threatByNpcId.get(entityId),
      debugClearThreat: (entityId: string) => {
        threatByNpcId.set(entityId, {
          lastAttackerEntityId: undefined,
          lastAggroAt: undefined,
          threatByEntityId: {},
          forcedTargetEntityId: undefined,
          forcedUntil: undefined,
        });
        return true;
      },
      debugSetThreatValue: (npcId: string, targetId: string, value: number, opts?: { add?: boolean; now?: number }) => {
        const st = threatByNpcId.get(npcId) ?? { threatByEntityId: {} };
        const table = { ...(st.threatByEntityId ?? {}) };
        const base = typeof table[targetId] === "number" ? table[targetId] : 0;
        table[targetId] = Math.max(0, opts?.add ? base + value : value);
        threatByNpcId.set(npcId, {
          ...st,
          lastAggroAt: opts?.now ?? Date.now(),
          lastAttackerEntityId: st.lastAttackerEntityId ?? targetId,
          threatByEntityId: table,
        });
        return true;
      },
      debugForceTarget: (npcId: string, targetId: string, durationMs: number, opts?: { now?: number }) => {
        const st = threatByNpcId.get(npcId) ?? { threatByEntityId: {} };
        const now = opts?.now ?? Date.now();
        threatByNpcId.set(npcId, {
          ...st,
          forcedTargetEntityId: targetId,
          forcedUntil: now + durationMs,
        });
        return true;
      },
    },
  };

  return { ctx, npc, player, sent, threatByNpcId };
}

test("[contract] debug_threat: --set and --clear mutate threat state", async () => {
  const { ctx, npc, player, threatByNpcId } = makeCtx();

  // Clear first.
  const cleared = await handleDebugThreat(ctx, null, { cmd: "debug_threat", args: [npc.id, "--clear"], parts: ["debug_threat", npc.id, "--clear"] });
  assert.ok(cleared.includes("Cleared"), "should report cleared");
  assert.equal(Object.keys(threatByNpcId.get(npc.id).threatByEntityId ?? {}).length, 0);

  // Set threat.
  const out = await handleDebugThreat(ctx, null, { cmd: "debug_threat", args: [npc.id, "--set", player.id, "25"], parts: ["debug_threat", npc.id, "--set", player.id, "25"] });
  assert.ok(out.includes("Set threat"), "should report set");
  assert.equal(threatByNpcId.get(npc.id).threatByEntityId[player.id], 25);
});

test("[contract] debug_threat: --force sets forced target window", async () => {
  const { ctx, npc, player, threatByNpcId } = makeCtx();

  const out = await handleDebugThreat(ctx, null, { cmd: "debug_threat", args: [npc.id, "--set", player.id, "1", "--force", "1000"], parts: ["debug_threat", npc.id, "--set", player.id, "1", "--force", "1000"] });
  assert.ok(out.includes("force=1000"), "should mention force ms");
  assert.equal(threatByNpcId.get(npc.id).forcedTargetEntityId, player.id);
  assert.ok(typeof threatByNpcId.get(npc.id).forcedUntil === "number");
});

test("[contract] debug_threat: --watch starts and --watch off stops", async () => {
  const { ctx, npc, sent } = makeCtx();

  const start = await handleDebugThreat(ctx, null, { cmd: "debug_threat", args: [npc.id, "--watch", "50"], parts: ["debug_threat", npc.id, "--watch", "50"] });
  assert.ok(start.includes("Watch started"), "should start watch");

  const stop = await handleDebugThreat(ctx, null, { cmd: "debug_threat", args: ["--watch", "off"], parts: ["debug_threat", "--watch", "off"] });
  assert.ok(stop.includes("Watch stopped") || stop.includes("already off"), "should stop watch");

  // Note: we don't assert interval output here to avoid test flakiness.
  assert.ok(Array.isArray(sent));
});
