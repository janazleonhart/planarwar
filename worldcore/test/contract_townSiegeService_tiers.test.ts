// worldcore/test/contract_townSiegeService_tiers.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { WorldEventBus } from "../world/WorldEventBus";
import { TownSiegeService } from "../world/TownSiegeService";

test("[contract] TownSiegeService tiers: warning -> siege -> recovery (no breach)", () => {
  process.env.PW_TOWN_SANCTUARY_SIEGE_TTL_MS = "10000";
  process.env.PW_TOWN_SIEGE_WARNING_MS = "2000";
  process.env.PW_TOWN_SIEGE_RECOVERY_MS = "3000";
  process.env.PW_TOWN_SIEGE_BREACH_HITS = "99"; // effectively disable breach

  const bus = new WorldEventBus();
  const siege = new TownSiegeService(bus);

  const roomId = "prime_shard:1,0";
  const t0 = Date.now();

  bus.emit("town.sanctuary.siege", { shardId: "prime_shard", roomId, pressureCount: 5, windowMs: 15000 });

  // We can't control the internal Date.now() inside the handler, so read the stored state to anchor times.
  const st = siege.getSiegeState(roomId);
  assert.ok(st, "state should exist immediately after event");

  const at0 = st.lastEventTs;
  assert.equal(siege.getTier(roomId, at0 + 100), "warning");
  assert.equal(siege.getTier(roomId, st.warningUntilTs + 10), "siege");
  assert.equal(siege.isUnderSiege(roomId, st.siegeUntilTs - 1), true);

  // After siege ends, recovery should be active.
  assert.equal(siege.isUnderSiege(roomId, st.siegeUntilTs + 1), false);
  assert.equal(siege.getTier(roomId, st.siegeUntilTs + 1), "recovery");

  // After recovery ends, tier should be none.
  assert.equal(siege.getTier(roomId, st.recoveryUntilTs + 1), "none");
});
