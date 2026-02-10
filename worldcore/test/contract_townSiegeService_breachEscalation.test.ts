// worldcore/test/contract_townSiegeService_breachEscalation.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { WorldEventBus } from "../world/WorldEventBus";
import { TownSiegeService } from "../world/TownSiegeService";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete (process.env as any)[k];
    else (process.env as any)[k] = v;
  }

  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete (process.env as any)[k];
      else (process.env as any)[k] = v;
    }
  }
}

test("[contract] TownSiegeService: repeated siege triggers can escalate to a short breach window (and emits event)", () => {
  withEnv(
    {
      PW_TOWN_SANCTUARY_SIEGE_TTL_MS: "60000",
      PW_TOWN_SIEGE_BREACH_TTL_MS: "5000",
      PW_TOWN_SIEGE_BREACH_HITS: "2",
      PW_TOWN_SIEGE_BREACH_WINDOW_MS: "10000",
    },
    () => {
      const bus = new WorldEventBus();
      const siege = new TownSiegeService(bus);

      const roomId = "prime_shard:1,0";

      let breachEvents = 0;
      bus.on("town.sanctuary.breach", (p) => {
        breachEvents += 1;
        assert.equal(p.roomId, roomId);
        assert.ok(typeof p.breachUntilTs === "number" && p.breachUntilTs > Date.now());
      });

      // Two siege triggers within the breach window should cause a breach.
      bus.emit("town.sanctuary.siege", {
        shardId: "prime_shard",
        roomId,
        pressureCount: 10,
        windowMs: 15000,
      });

      assert.equal(siege.isBreachActive(roomId), false, "should not breach on first trigger when hits=2");

      bus.emit("town.sanctuary.siege", {
        shardId: "prime_shard",
        roomId,
        pressureCount: 11,
        windowMs: 15000,
      });

      assert.equal(breachEvents, 1, "should emit exactly one breach event when threshold is reached");
      assert.equal(siege.isBreachActive(roomId), true, "breach should become active after threshold is reached");

      const now = Date.now();
      assert.equal(siege.isBreachActive(roomId, now + 5000 + 5), false, "breach should expire after breach TTL");
    },
  );
});
