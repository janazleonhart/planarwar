// worldcore/test/contract_regionFlags_trainPursuitProfileShort.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { applyTrainProfileForRegion } from "../npc/NpcManager";

test("[contract] regions.flags rules.ai.pursuit=short clamps Train chase tuning (does not force enable)", () => {
  const baseEnabled = {
    enabled: true,
    step: 1.5,
    softLeash: 25,
    hardLeash: 40,
    pursueTimeoutMs: 20_000,
    roomsEnabled: true,
    maxRoomsFromSpawn: 6,
    assistEnabled: true,
    assistSnapAllies: true,
    assistSnapMaxAllies: 6,
    assistRange: 10,
    returnMode: "snap" as const,
  };

  const short = applyTrainProfileForRegion(baseEnabled, "short");
  assert.equal(short.enabled, true);
  assert.ok(short.softLeash <= 12);
  assert.ok(short.hardLeash <= 20);
  assert.ok(short.pursueTimeoutMs <= 6_000);
  assert.ok(short.maxRoomsFromSpawn <= 1);
  assert.equal(short.assistEnabled, false);
  assert.equal(short.assistSnapAllies, false);

  const baseDisabled = { ...baseEnabled, enabled: false };
  const shortDisabled = applyTrainProfileForRegion(baseDisabled, "short");
  assert.equal(shortDisabled.enabled, false);
  assert.deepEqual(shortDisabled, baseDisabled);
});
