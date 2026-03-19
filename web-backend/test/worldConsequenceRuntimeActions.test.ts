//web-backend/test/worldConsequenceRuntimeActions.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { getOrCreatePlayerState } from "../gameState";
import { pushWorldConsequence, buildSetbackWorldConsequence } from "../domain/worldConsequences";
import { executeWorldConsequenceAction } from "../domain/worldConsequenceRuntimeActions";

function seedPressure() {
  const ps = getOrCreatePlayerState(`runtime_action_${Date.now()}_${Math.random()}`);
  ps.worldConsequences = [];
  pushWorldConsequence(
    ps,
    buildSetbackWorldConsequence({
      missionId: "mission_pressure",
      missionTitle: "Broken convoy",
      regionId: ps.city.regionId,
      outcome: "failure",
      pressureDelta: 8,
      recoveryDelta: 10,
      controlDelta: -3,
      threatDelta: 4,
      setbackCount: 2,
    }),
  );
  return ps;
}

test("successful response action cools propagated world state", () => {
  const ps = seedPressure();
  const beforeTrade = ps.worldConsequenceState?.worldEconomy.tradePressure ?? 0;
  const beforeDestabilization = ps.worldConsequenceState?.summary.destabilizationScore ?? 0;
  const beforeWealth = ps.resources.wealth ?? 0;

  const result = executeWorldConsequenceAction(ps, "action_stabilize_supply_lanes");
  assert.equal(result.ok, true);
  assert.equal(result.status, "ok");
  assert.ok((ps.worldConsequenceState?.worldEconomy.tradePressure ?? 0) < beforeTrade);
  assert.ok((ps.worldConsequenceState?.summary.destabilizationScore ?? 0) < beforeDestabilization);
  assert.ok((ps.resources.wealth ?? 0) < beforeWealth);
});

test("unsupported black-market exploit action remains advisory only", () => {
  const ps = seedPressure();
  ps.techFlags = ["BLACK_MARKET_ENABLED"];
  pushWorldConsequence(
    ps,
    buildSetbackWorldConsequence({
      missionId: "mission_surging",
      missionTitle: "Smuggling surge",
      regionId: ps.city.regionId,
      outcome: "failure",
      pressureDelta: 10,
      recoveryDelta: 12,
      controlDelta: -2,
      threatDelta: 5,
      setbackCount: 3,
    }),
  );

  const result = executeWorldConsequenceAction(ps, "action_black_market_window_exploit");
  assert.equal(result.ok, false);
  assert.equal(result.status, "not_executable");
});
