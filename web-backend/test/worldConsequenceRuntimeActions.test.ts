//web-backend/test/worldConsequenceRuntimeActions.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { getOrCreatePlayerState } from "../gameState";
import {
  pushWorldConsequence,
  buildSetbackWorldConsequence,
  summarizeWorldConsequenceResponseReceipts,
} from "../domain/worldConsequences";
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

test("player action cards expose which follow-up actions a spend would block", () => {
  const ps = seedPressure();
  ps.resources.wealth = 17;
  ps.resources.materials = 8;
  ps.resources.unity = 6;

  const actions = deriveWorldConsequenceActions(ps);
  const stabilize = actions.playerActions.find((action) => action.id === "action_stabilize_supply_lanes");
  assert.ok(stabilize);
  assert.ok(stabilize?.runtime?.blockedFollowupActionIds?.includes("action_faction_stability"));
  assert.ok(
    stabilize?.runtime?.blockedFollowupActionTitles?.includes(
      "Repair faction stability before local pressure turns political",
    ),
  );
});

test("player action cards expose which follow-up actions stay open after spend", () => {
  const ps = seedPressure();
  ps.resources.wealth = 20;
  ps.resources.materials = 10;
  ps.resources.unity = 8;

  const actions = deriveWorldConsequenceActions(ps);
  const stabilize = actions.playerActions.find((action) => action.id === "action_stabilize_supply_lanes");
  assert.ok(stabilize);
  assert.ok(stabilize?.runtime?.availableFollowupActionIds?.includes("action_faction_stability"));
  assert.ok(
    stabilize?.runtime?.availableFollowupActionTitles?.includes(
      "Repair faction stability before local pressure turns political",
    ),
  );

  ps.resources.wealth = 17;
  const tighter = deriveWorldConsequenceActions(ps).playerActions.find((action) => action.id === "action_stabilize_supply_lanes");
  assert.ok(tighter);
  assert.equal(tighter?.runtime?.availableFollowupActionIds?.includes("action_faction_stability"), false);
});

test("player action cards expose a recommended next follow-up after spend", () => {
  const ps = seedPressure();
  ps.resources.wealth = 20;
  ps.resources.materials = 10;
  ps.resources.unity = 8;

  const actions = deriveWorldConsequenceActions(ps);
  const stabilize = actions.playerActions.find((action) => action.id === "action_stabilize_supply_lanes");
  assert.ok(stabilize);
  assert.equal(stabilize?.runtime?.recommendedFollowupActionId, "action_faction_stability");
  assert.equal(
    stabilize?.runtime?.recommendedFollowupActionTitle,
    "Repair faction stability before local pressure turns political",
  );

  ps.resources.wealth = 17;
  const tighter = deriveWorldConsequenceActions(ps).playerActions.find((action) => action.id === "action_stabilize_supply_lanes");
  assert.ok(tighter);
  assert.equal(tighter?.runtime?.recommendedFollowupActionId, undefined);
  assert.equal(tighter?.runtime?.recommendedFollowupActionTitle, undefined);
});



test("player action cards expose remaining resources after paying bounded response cost", () => {
  const ps = seedPressure();
  const actions = deriveWorldConsequenceActions(ps);
  const stabilize = actions.playerActions.find((action) => action.id === "action_stabilize_supply_lanes");
  assert.ok(stabilize);
  assert.deepEqual(stabilize?.runtime?.remainingAfterCost, {
    wealth: (ps.resources.wealth ?? 0) - 10,
    materials: (ps.resources.materials ?? 0) - 8,
  });

  ps.resources.wealth = 0;
  const starved = deriveWorldConsequenceActions(ps).playerActions.find((action) => action.id === "action_stabilize_supply_lanes");
  assert.equal(starved?.runtime?.remainingAfterCost, undefined);
});

test("player action cards expose post-commit city state previews", () => {
  const ps = seedPressure();
  const actions = deriveWorldConsequenceActions(ps);
  const stabilize = actions.playerActions.find((action) => action.id === "action_stabilize_supply_lanes");
  assert.ok(stabilize?.runtime?.postCommitState);
  assert.equal(stabilize?.runtime?.postCommitState?.unity, (ps.city.stats.unity ?? 0) + 1);
  assert.equal(stabilize?.runtime?.postCommitState?.threatPressure, Math.max(0, (ps.cityStress.threatPressure ?? 0) - 5));
  assert.equal(stabilize?.runtime?.postCommitState?.recoveryBurden, Math.max(0, (ps.cityStress.recoveryBurden ?? 0) - 4));
  assert.equal(stabilize?.runtime?.postCommitState?.unityPressure, Math.max(0, (ps.cityStress.unityPressure ?? 0) - 1));
  assert.equal(stabilize?.runtime?.postCommitState?.currentStage, ps.cityStress.stage);
  assert.equal(stabilize?.runtime?.postCommitState?.stage, "stable");
  assert.equal(stabilize?.runtime?.postCommitState?.stageChanged, false);

  ps.cityStress.total = 26;
  ps.cityStress.stage = "strained";
  const calmer = deriveWorldConsequenceActions(ps).playerActions.find((action) => action.id === "action_stabilize_supply_lanes");
  assert.equal(calmer?.runtime?.postCommitState?.currentStage, "strained");
  assert.equal(calmer?.runtime?.postCommitState?.stage, "stable");
  assert.equal(calmer?.runtime?.postCommitState?.stageChanged, true);

  ps.resources.wealth = 0;
  const starved = deriveWorldConsequenceActions(ps).playerActions.find((action) => action.id === "action_stabilize_supply_lanes");
  assert.equal(starved?.runtime?.postCommitState, undefined);
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
  assert.deepEqual(receipts.recent[0]?.spent, { wealth: 10, materials: 8 });
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

test("successful response action enters cooldown and exposes ready time truth", () => {
  const ps = seedPressure();
  const first = executeWorldConsequenceAction(ps, "action_stabilize_supply_lanes");
  assert.equal(first.ok, true);

  const second = executeWorldConsequenceAction(ps, "action_stabilize_supply_lanes");
  assert.equal(second.ok, false);
  assert.equal(second.status, "cooldown_active");
  assert.ok(second.readyAt);
  assert.ok((second.cooldownMsRemaining ?? 0) > 0);
  assert.equal(second.action?.runtime?.affordability, "cooldown_active");
  assert.equal(second.action?.runtime?.buttonLabel, "Cooling down");
  assert.ok((second.action?.runtime?.cooldownMsRemaining ?? 0) > 0);
  assert.equal(second.action?.runtime?.readyAt, second.readyAt);
});

test("player action cards expose recent runtime action history", () => {
  const ps = seedPressure();
  const first = executeWorldConsequenceAction(ps, "action_stabilize_supply_lanes");
  assert.equal(first.ok, true);

  const view = deriveWorldConsequenceActions(ps);
  const action = view.playerActions.find((entry) => entry.id === "action_stabilize_supply_lanes");
  assert.ok(action);
  assert.equal(action?.runtime?.affordability, "cooldown_active");
  assert.equal(action?.runtime?.successfulCommitCount, 1);
  assert.ok(typeof action?.runtime?.lastCommittedAt === "string");
});

test("player action cards expose action evidence instead of just vibes", () => {
  const ps = seedPressure();
  const actions = deriveWorldConsequenceActions(ps);
  const stabilize = actions.playerActions.find((action) => action.id === "action_stabilize_supply_lanes");
  assert.ok(stabilize);
  assert.deepEqual(
    stabilize?.evidence?.map((entry) => entry.label),
    ["trade pressure", "supply friction", "destabilization"],
  );
  assert.equal(stabilize?.evidence?.[0]?.value, ps.worldConsequenceState?.worldEconomy.tradePressure ?? 0);
  assert.equal(stabilize?.evidence?.[0]?.tone, "high");
});

test("player action cards expose last applied world action results", () => {
  const ps = seedPressure();
  const result = executeWorldConsequenceAction(ps, "action_stabilize_supply_lanes");
  assert.equal(result.ok, true);

  const actions = deriveWorldConsequenceActions(ps);
  const stabilize = actions.playerActions.find((action) => action.id === "action_stabilize_supply_lanes");
  assert.ok(stabilize);
  assert.ok(stabilize?.runtime?.lastReceiptId);
  assert.match(stabilize?.runtime?.lastReceiptSummary ?? "", /scarcity pressure|Costs committed/i);
  assert.deepEqual(stabilize?.runtime?.lastAppliedEffect, {
    pressureDelta: -5,
    recoveryDelta: -4,
    controlDelta: 1,
    threatDelta: -2,
  });
});


test("player action cards expose last actual spend for bounded runtime responses", () => {
  const ps = seedPressure();
  const result = executeWorldConsequenceAction(ps, "action_stabilize_supply_lanes");
  assert.equal(result.ok, true);

  const actions = deriveWorldConsequenceActions(ps);
  const stabilize = actions.playerActions.find((action) => action.id === "action_stabilize_supply_lanes");
  assert.ok(stabilize);
  assert.deepEqual(stabilize?.runtime?.lastSpent, { wealth: 10, materials: 8 });
});
