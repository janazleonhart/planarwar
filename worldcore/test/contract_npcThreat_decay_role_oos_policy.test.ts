// worldcore/test/contract_npcThreat_decay_role_oos_policy.test.ts
//
// Contract: threat decay applies deterministic policy multipliers based on:
// - combat role (tanks decay slower, DPS decays faster)
// - out-of-sight validity (out_of_room decays harder)

import test from "node:test";
import assert from "node:assert/strict";

import { decayThreat, type NpcThreatState } from "../npc/NpcThreat";

test("[contract] npcThreat: role + out_of_room decay policy is applied per bucket", () => {
  // Read at call-time: tests can safely set env after import.
  (process.env as any).PW_THREAT_DECAY_ROLE_TANK_MULT = "0.5";
  (process.env as any).PW_THREAT_DECAY_ROLE_DPS_MULT = "2";
  (process.env as any).PW_THREAT_DECAY_ROLE_HEALER_MULT = "1";
  (process.env as any).PW_THREAT_DECAY_ROLE_UNKNOWN_MULT = "1";
  (process.env as any).PW_THREAT_DECAY_OUT_OF_SIGHT_MULT = "3";
  (process.env as any).PW_THREAT_PRUNE_INVALID_BUCKETS = "0";

  const t0: NpcThreatState = {
    threatByEntityId: {
      tank: 100,
      dps: 100,
      oos: 100,
    },
    lastAggroAt: 0,
    lastDecayAt: 0,
  };

  // dt = 5s, base decay = 10/s => 50 points baseline.
  const t1 = decayThreat(t0, {
    now: 5000,
    decayPerSec: 10,
    pruneBelow: 0,
    getRoleForEntityId: (id: string) => {
      if (id === "tank") return "tank";
      if (id === "dps") return "dps";
      return "unknown";
    },
    validateTarget: (id: string) => {
      if (id === "oos") return { ok: false, reason: "out_of_room" };
      return { ok: true };
    },
  });

  // tank: dec = 50 * 0.5 = 25 => 75 remaining
  assert.equal(t1?.threatByEntityId?.tank, 75);

  // dps: dec = 50 * 2 = 100 => pruned (<= pruneBelow)
  assert.ok(!("dps" in (t1?.threatByEntityId ?? {})));

  // oos: dec = 50 * 3 = 150 => pruned
  assert.ok(!("oos" in (t1?.threatByEntityId ?? {})));

  // Whole-second decay keeps remainder ms consistent.
  assert.equal(t1?.lastDecayAt, 5000);
});
