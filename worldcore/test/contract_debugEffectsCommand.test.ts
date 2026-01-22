// worldcore/test/contract_debugEffectsCommand.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { handleDebugEffects } from "../mud/commands/debug/debugEffectsCommand";

test("[contract] debug_effects resolves nearby handle and prints active effects", async () => {
  const now = Date.now();

  const self = {
    id: "player.self",
    type: "player",
    name: "Rimuru",
    ownerSessionId: "sess.self",
    x: 0,
    z: 0,
    alive: true,
    hp: 10,
    maxHp: 10,
  };

  const rat = {
    id: "npc.rat.1",
    type: "npc",
    name: "Feral Rat",
    x: 3,
    z: 4,
    alive: true,
    hp: 5,
    maxHp: 5,
    combatStatusEffects: {
      active: {
        poison: {
          id: "poison",
          sourceKind: "spell",
          sourceId: "spell.poison.rank1",
          appliedAtMs: now - 1000,
          expiresAtMs: now + 60_000,
          stackCount: 1,
          maxStacks: 3,
          modifiers: { damageTakenPct: 0.1 },
          tags: ["dot"],
          dot: { tickIntervalMs: 1000, perTickDamage: 2, nextTickAtMs: now + 500 },
        },
      },
    },
  };

  const ctx: any = {
    session: { id: "sess.self", roomId: "room.test" },
    entities: {
      getEntityByOwner: (sid: string) => (sid === "sess.self" ? self : null),
      getEntitiesInRoom: (_roomId: string) => [self, rat],
      getEntityById: (_id: string) => null,
    },
    sessions: {
      get: (_sid: string) => ({ character: null }),
    },
  };

  const char: any = { posX: 0, posZ: 0 };

  const out = await handleDebugEffects(ctx, char, { cmd: "debug_effects", args: ["rat.1"], parts: [] });
  assert.match(out, /\[debug_effects\]/);
  assert.match(out, /Feral Rat/);
  assert.match(out, /poison/);
  assert.match(out, /dmgTaken/);
});

test("[contract] debug_effects --json returns valid JSON", async () => {
  const self = {
    id: "player.self",
    type: "player",
    name: "Rimuru",
    ownerSessionId: "sess.self",
    x: 0,
    z: 0,
    alive: true,
    hp: 10,
    maxHp: 10,
  };

  const ctx: any = {
    session: { id: "sess.self", roomId: "room.test" },
    entities: {
      getEntityByOwner: (sid: string) => (sid === "sess.self" ? self : null),
      getEntitiesInRoom: (_roomId: string) => [self],
      getEntityById: (_id: string) => null,
    },
    sessions: { get: (_sid: string) => ({ character: null }) },
  };

  const char: any = { posX: 0, posZ: 0 };

  const out = await handleDebugEffects(ctx, char, { cmd: "debug_effects", args: ["--json"], parts: [] });
  const parsed = JSON.parse(out);
  assert.equal(parsed?.target?.id, "player.self");
  assert.ok(parsed?.effects);
  assert.ok(parsed?.snapshot);
});
