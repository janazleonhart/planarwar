// worldcore/test/contract_restCommand_restSpotGating.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { handleRestCommand } from "../mud/commands/player/recoveryCommand";

type AnyChar = any;

type AnyCtx = any;

function makeChar(args: { id: string; name: string; x?: number; z?: number }): AnyChar {
  return {
    id: args.id,
    name: args.name,
    level: 1,
    classId: "archmage",
    pos: { x: args.x ?? 0, z: args.z ?? 0 },
    progression: { powerResources: {}, cooldowns: {}, skills: {} },
    spellbook: { known: {} },
    flags: {},
    statusEffects: {},
  };
}

function makeCtx(args: { roomId: string; entitiesInRoom?: any[]; ownerEntity?: any }): AnyCtx {
  return {
    session: {
      id: "sess_rest_1",
      roomId: args.roomId,
      auth: null,
      character: makeChar({ id: "char_rest_1", name: "Tester", x: 0, z: 0 }),
    },
    entities: {
      getEntitiesInRoom: (_roomId: string) => args.entitiesInRoom ?? [],
      getEntityByOwner: (_sid: string) =>
        args.ownerEntity ?? {
          hp: 50,
          maxHp: 100,
          alive: true,
          inCombatUntil: 0,
        },
    },
  };
}

function withEnv(key: string, value: string | undefined, fn: () => Promise<void> | void) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;

  const done = async () => {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  };

  return Promise.resolve(fn()).finally(done);
}

test("[contract] rest: PW_REST_GATES=1 requires a rest spot/inn anchor", async () => {
  await withEnv("PW_REST_GATES", "1", async () => {
    const roomId = "prime_shard:1,0";

    // No rest spot => denied
    {
      const ctx = makeCtx({ roomId, entitiesInRoom: [] });
      const out = await handleRestCommand(ctx as any);
      assert.ok(
        String(out).startsWith("[rest]"),
        `Expected rest denial when no anchor, got: ${out}`,
      );
      assert.ok(String(out).toLowerCase().includes("rest"));
    }

    // Rest spot within range => allowed (returns a normal rest message)
    {
      const ctx = makeCtx({
        roomId,
        entitiesInRoom: [{ type: "rest", x: 1, z: 0, tags: ["rest"], protoId: "rest_spot_basic" }],
      });
      const out = await handleRestCommand(ctx as any);
      assert.ok(!String(out).startsWith("[rest]"), `Expected rest to succeed near rest spot, got: ${out}`);
    }
  });
});
