//worldcore/test/contract_townSiegeAlarmService_broadcast.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { WorldEventBus } from "../world/WorldEventBus";
import { TownSiegeAlarmService } from "../world/TownSiegeAlarmService";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("[contract] TownSiegeAlarmService: siege event broadcasts to town room (and optional neighbor rooms)", () => {
  withEnv(
    {
      PW_TOWN_SIEGE_ALARM_RANGE_TILES: "1",
      PW_TOWN_SIEGE_ALARM_COOLDOWN_MS: "0",
    },
    () => {
      const bus = new WorldEventBus();

      const calls: Array<{ roomId: string; op: string; text: string }> = [];
      const rooms = new Map<string, any>();

      const mkRoom = (roomId: string) => ({
        broadcast(op: string, payload: any) {
          calls.push({ roomId, op, text: String(payload?.text ?? "") });
        },
      });

      rooms.set("prime_shard:0,0", mkRoom("prime_shard:0,0"));
      rooms.set("prime_shard:1,0", mkRoom("prime_shard:1,0"));

      // service under test
      new TownSiegeAlarmService(bus, {
        get: (roomId: string) => rooms.get(roomId),
      });

      bus.emit("town.sanctuary.siege", {
        shardId: "prime_shard",
        roomId: "prime_shard:0,0",
        pressureCount: 99,
        windowMs: 15000,
      });

      const hitCenter = calls.some((c) => c.roomId === "prime_shard:0,0" && c.op === "chat");
      assert.equal(hitCenter, true, "expected chat broadcast into the siege room");

      const hitNeighbor = calls.some((c) => c.roomId === "prime_shard:1,0" && c.op === "chat");
      assert.equal(hitNeighbor, true, "expected chat broadcast into neighbor room within range");

      const hasText = calls.some((c) => c.text.includes("bells") || c.text.includes("gates"));
      assert.equal(hasText, true, "expected a diegetic alarm message");
    },
  );
});

test("[contract] TownSiegeAlarmService: cooldown suppresses repeated siege alarms", () => {
  withEnv(
    {
      PW_TOWN_SIEGE_ALARM_RANGE_TILES: "0",
      PW_TOWN_SIEGE_ALARM_COOLDOWN_MS: "60000",
    },
    () => {
      const bus = new WorldEventBus();

      let count = 0;
      const rooms = new Map<string, any>();
      rooms.set("prime_shard:0,0", {
        broadcast() {
          count += 1;
        },
      });

      new TownSiegeAlarmService(bus, {
        get: (roomId: string) => rooms.get(roomId),
      });

      const payload = {
        shardId: "prime_shard",
        roomId: "prime_shard:0,0",
        pressureCount: 12,
        windowMs: 15000,
      };

      bus.emit("town.sanctuary.siege", payload);
      bus.emit("town.sanctuary.siege", payload);

      assert.equal(count, 1, "expected only one broadcast during cooldown window");
    },
  );
});
