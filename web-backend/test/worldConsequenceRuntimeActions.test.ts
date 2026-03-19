//web-backend/test/worldConsequenceRuntimeActions.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { getOrCreatePlayerState } from "../gameState";
import { pushWorldConsequence, buildSetbackWorldConsequence, summarizeWorldConsequenceResponseReceipts } from "../domain/worldConsequences";
import { executeWorldConsequenceAction } from "../domain/worldConsequenceRuntimeActions";
import { deriveWorldConsequenceActions } from "../domain/worldConsequenceActions";

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
  assert.equal(result.appliedEffect?.pressureDelta, -5);
  assert.equal(result.appliedEffect?.recoveryDelta, -4);
  assert.equal(result.appliedEffect?.threatDelta, -2);
  assert.match(result.appliedEffect?.summary ?? "", /scarcity pressure/i);
  assert.ok(result.receiptId);
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


test("player action cards expose runtime truth instead of frontend guesses", () => {
  const ps = seedPressure();
  const actions = deriveWorldConsequenceActions(ps);
  const stabilize = actions.playerActions.find((action) => action.id === "action_stabilize_supply_lanes");
  assert.ok(stabilize);
  assert.equal(stabilize?.runtime?.executable, true);
  assert.equal(stabilize?.runtime?.affordability, "affordable");
  assert.deepEqual(stabilize?.runtime?.cost, { wealth: 10, materials: 8 });

  ps.resources.wealth = 0;
  const starved = deriveWorldConsequenceActions(ps).playerActions.find((action) => action.id === "action_stabilize_supply_lanes");
  assert.ok(starved);
  assert.equal(starved?.runtime?.executable, false);
  assert.equal(starved?.runtime?.affordability, "insufficient_resources");
  assert.deepEqual(starved?.runtime?.shortfall, { wealth: 10 });
  assert.match(starved?.runtime?.note ?? "", /wealth 10/i);

  ps.resources.materials = 0;
  const fullyStarved = deriveWorldConsequenceActions(ps).playerActions.find((action) => action.id === "action_stabilize_supply_lanes");
  assert.ok(fullyStarved);
  assert.deepEqual(fullyStarved?.runtime?.shortfall, { wealth: 10, materials: 8 });
});



test("player action cards expose runtime impact previews instead of hidden payoff math", () => {
  const ps = seedPressure();
  const actions = deriveWorldConsequenceActions(ps);
  const stabilize = actions.playerActions.find((action) => action.id === "action_stabilize_supply_lanes");
  assert.ok(stabilize?.runtime?.effect);
  assert.equal(stabilize?.runtime?.effect?.pressureDelta, -5);
  assert.equal(stabilize?.runtime?.effect?.recoveryDelta, -4);
  assert.equal(stabilize?.runtime?.effect?.threatDelta, -2);
  assert.match(stabilize?.runtime?.effect?.summary ?? "", /scarcity pressure/i);

  const exploit = actions.playerActions.find((action) => action.id === "action_black_market_window_exploit");
  assert.equal(exploit?.runtime?.effect, undefined);
});

test("successful response action is surfaced as a bounded runtime receipt", () => {
  const ps = seedPressure();
  const result = executeWorldConsequenceAction(ps, "action_stabilize_supply_lanes");
  assert.equal(result.ok, true);

  const receipts = summarizeWorldConsequenceResponseReceipts(ps.worldConsequences ?? []);
  assert.equal(receipts.totalRuntimeResponses, 1);
  assert.equal(receipts.recent[0]?.outcome, "success");
  assert.equal(receipts.recent[0]?.contractKind, "relief_convoys");
  assert.match(receipts.recent[0]?.title ?? "", /Response action executed:/);
});


test("insufficient resource execution returns exact shortfall truth", () => {
  const ps = seedPressure();
  ps.resources.wealth = 0;

  const result = executeWorldConsequenceAction(ps, "action_stabilize_supply_lanes");
  assert.equal(result.ok, false);
  assert.equal(result.status, "insufficient_resources");
  assert.deepEqual(result.shortfall, { wealth: 10 });
  assert.equal(result.action?.runtime?.affordability, "insufficient_resources");
  assert.deepEqual(result.action?.runtime?.shortfall, { wealth: 10 });
});
