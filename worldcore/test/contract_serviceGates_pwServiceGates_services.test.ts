// worldcore/test/contract_serviceGates_pwServiceGates_services.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { requireTownService } from "../mud/commands/world/serviceGates";
import { setRegionFlagsTestOverrides } from "../world/RegionFlags";
import { WorldEventBus } from "../world/WorldEventBus";
import { TownSiegeService } from "../world/TownSiegeService";

type AnyChar = any;

function makeChar(args: { id: string; name: string; x?: number; z?: number }): AnyChar {
  return {
    id: args.id,
    name: args.name,
    level: 1,
    classId: "outrider",
    pos: { x: args.x ?? 0, z: args.z ?? 0 },
    progression: { powerResources: {}, cooldowns: {}, skills: {} },
    spellbook: { known: {} },
    flags: {},
    statusEffects: {},
  };
}

function makeCtx(args: { roomId: string; entitiesInRoom?: any[]; siege?: any }): any {
  return {
    session: { roomId: args.roomId, auth: null },
    entities: {
      getEntitiesInRoom: (_roomId: string) => args.entitiesInRoom ?? [],
    },
    townSiege: args.siege ?? null,
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

test("[contract] serviceGates: bank/mail/auction are gated by PW_SERVICE_GATES + service_* anchors", async () => {
  await withEnv("PW_SERVICE_GATES", "1", async () => {
    const roomId = "prime_shard:1,0";
    const char = makeChar({ id: "char_svc_1", name: "Tester", x: 0, z: 0 });

    const services: Array<{ service: any; tag: string }> = [
      { service: "bank", tag: "service_bank" },
      { service: "mail", tag: "service_mail" },
      { service: "auction", tag: "service_auction" },
    ];

    for (const s of services) {
      // No anchor => denied (prevents remote services from wilderness)
      {
        const ctx = makeCtx({ roomId, entitiesInRoom: [] });
        const out = await requireTownService(ctx, char, s.service, () => "OK");
        assert.equal(typeof out, "string");
        assert.ok(
          String(out).includes("No") && String(out).includes(String(s.service)),
          `Expected denyNoAnchor for ${s.service}, got: ${out}`,
        );
      }

      // Anchor exists but out of range => denied
      {
        const ctx = makeCtx({
          roomId,
          entitiesInRoom: [{ type: "npc", tags: [s.tag], x: 99, z: 0, protoId: `svc_${s.service}` }],
        });
        const out = await requireTownService(ctx, char, s.service, () => "OK");
        assert.equal(typeof out, "string");
        assert.ok(String(out).includes("must be closer"), `Expected out-of-range deny for ${s.service}, got: ${out}`);
      }

      // Anchor exists within range => allowed
      {
        const ctx = makeCtx({
          roomId,
          entitiesInRoom: [{ type: "npc", tags: [s.tag], x: 1, z: 0, protoId: `svc_${s.service}` }],
        });
        const out = await requireTownService(ctx, char, s.service, () => "OK");
        assert.equal(out, "OK");
      }
    }
  });
});

test("[contract] serviceGates: economy lockdown on siege denies bank/mail/auction when PW_SERVICE_GATES=1", async () => {
  setRegionFlagsTestOverrides({
    prime_shard: {
      "1,0": {
        rules: {
          economy: { lockdownOnSiege: true },
          ai: { townSanctuary: true },
          travel: { lockdownOnSiege: false },
        },
      },
    },
  });

  try {
    await withEnv("PW_SERVICE_GATES", "1", async () => {
      const bus = new WorldEventBus();
      const siege = new TownSiegeService(bus);

      const roomId = "prime_shard:1,0";
      bus.emit("town.sanctuary.siege", {
        shardId: "prime_shard",
        roomId,
        pressureCount: 99,
        windowMs: 15000,
      });

      const char = makeChar({ id: "char_siege_svc_1", name: "Tester", x: 0, z: 0 });
      const ctx = makeCtx({ roomId, entitiesInRoom: [], siege });

      for (const svc of ["bank", "mail", "auction"] as const) {
        const out = await requireTownService(ctx, char, svc, () => "OK");
        assert.equal(typeof out, "string");
        assert.ok(String(out).toLowerCase().includes("under siege"), `Expected siege denial for ${svc}, got: ${out}`);
      }
    });
  } finally {
    setRegionFlagsTestOverrides(null);
  }
});
