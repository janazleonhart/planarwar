// worldcore/test/contract_townSiegeService_state.test.ts

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

test("[contract] TownSiegeService: town.sanctuary.siege marks room under siege until TTL expires", () => {
  withEnv({ PW_TOWN_SANCTUARY_SIEGE_TTL_MS: "1000" }, () => {
    const bus = new WorldEventBus();
    const siege = new TownSiegeService(bus);

    const roomId = "prime_shard:0,0";

    // Emit a siege event (normally fired by sanctuary pressure threshold).
    bus.emit("town.sanctuary.siege", {
      shardId: "prime_shard",
      roomId,
      pressureCount: 12,
      windowMs: 15000,
    });

    const now = Date.now();

    assert.equal(siege.isUnderSiege(roomId, now), true, "room should be under siege immediately after event");

    const st = siege.getSiegeState(roomId, now);
    assert.ok(st, "state should exist");
    assert.equal(st.roomId, roomId);
    assert.equal(st.lastPressureCount, 12);

    // After TTL, siege should expire and state should be cleared.
    assert.equal(
      siege.isUnderSiege(roomId, now + 1000 + 5),
      false,
      "room should no longer be under siege after TTL",
    );
    assert.equal(siege.getSiegeState(roomId, now + 1000 + 5), null);
  });
});
