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
  // With tiering, state may persist into recovery after the active siege TTL.
  // Keep recovery short here so the contract stays deterministic.
  withEnv(
    {
      PW_TOWN_SANCTUARY_SIEGE_TTL_MS: "1000",
      PW_TOWN_SIEGE_RECOVERY_MS: "200",
      PW_TOWN_SIEGE_WARNING_MS: "0",
    },
    () => {
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

      // After the active siege TTL, it should no longer count as "under siege"...
      const afterSiege = now + 1000 + 5;
      assert.equal(siege.isUnderSiege(roomId, afterSiege), false, "room should not be under siege after TTL");

      // ...but state may persist briefly into recovery.
      assert.ok(siege.getSiegeState(roomId, afterSiege), "state should persist into recovery");

      // After recovery, the state should be cleared.
      const afterRecovery = now + 1000 + 200 + 10;
      assert.equal(siege.getSiegeState(roomId, afterRecovery), null);
    },
  );
});
