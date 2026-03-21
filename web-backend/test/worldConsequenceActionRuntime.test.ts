//web-backend/test/worldConsequenceActionRuntime.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { getOrCreatePlayerState } from "../gameState";
import {
  WORLD_CONSEQUENCE_ACTION_COOLDOWN_MS,
  buildWorldConsequenceActionRuntimeView,
} from "../domain/worldConsequenceActionRuntime";
import { buildRecoveryContractWorldConsequence, pushWorldConsequence } from "../domain/worldConsequences";

test("advisory-only world consequence actions stay non-executable", () => {
  const ps = getOrCreatePlayerState("world_consequence_runtime_advisory_player");

  const runtime = buildWorldConsequenceActionRuntimeView(ps, "admin_validate_signal_visibility");

  assert.equal(runtime.executable, false);
  assert.equal(runtime.affordability, "advisory_only");
  assert.equal(runtime.buttonLabel, "Advisory only");
  assert.deepEqual(runtime.cost, {});
  assert.equal(runtime.effect, undefined);
});

test("black-market exploit runtime view exposes shadow-economy upside and downside", () => {
  const ps = getOrCreatePlayerState("world_consequence_runtime_black_market_player");
  ps.techFlags = ["BLACK_MARKET_ENABLED"];

  const runtime = buildWorldConsequenceActionRuntimeView(ps, "action_black_market_window_exploit");
  assert.equal(runtime.executable, true);
  assert.equal(runtime.affordability, "affordable");
  assert.equal(runtime.buttonLabel, "Exploit window");
  assert.deepEqual(runtime.cost, { food: 3, materials: 2, unity: 1 });
  assert.deepEqual(runtime.effect?.grants, { wealth: 14, knowledge: 2 });
  assert.equal(runtime.effect?.pressureDelta, 4);
  assert.equal(runtime.effect?.threatDelta, 3);
  assert.ok((runtime.postCommitState?.unityPressure ?? 0) >= Number(ps.cityStress.unityPressure ?? 0));
});

test("affordable runtime view exposes blocked follow-up actions after hypothetical spend", () => {
  const ps = getOrCreatePlayerState("world_consequence_runtime_followup_player");
  ps.resources.wealth = 15;
  ps.resources.materials = 8;
  ps.resources.unity = 6;

  const runtime = buildWorldConsequenceActionRuntimeView(ps, "action_stabilize_supply_lanes", [
    { id: "action_stabilize_supply_lanes", title: "Fund stabilization" },
    { id: "action_faction_stability", title: "Fund civic response" },
  ]);

  assert.equal(runtime.executable, true);
  assert.equal(runtime.affordability, "affordable");
  assert.deepEqual(runtime.cost, { wealth: 10, materials: 8 });
  assert.deepEqual(runtime.remainingAfterCost, { wealth: 5, materials: 0 });
  assert.deepEqual(runtime.blockedFollowupActionIds, ["action_faction_stability"]);
  assert.deepEqual(runtime.blockedFollowupActionTitles, ["Fund civic response"]);
  assert.equal(runtime.recommendedFollowupActionId, undefined);
  assert.equal(runtime.postCommitState?.stage, "stable");
});

test("runtime cooldown view preserves commit history while blocking execution", () => {
  const ps = getOrCreatePlayerState("world_consequence_runtime_cooldown_player");
  ps.resources.wealth = 40;
  ps.resources.materials = 40;
  ps.resources.unity = 20;

  const recentCommitAt = new Date(Date.now() - 90_000).toISOString();
  pushWorldConsequence(
    ps,
    buildRecoveryContractWorldConsequence({
      missionId: "runtime_action_relief_convoys",
      missionTitle: "Runtime action relief convoys",
      regionId: ps.city.regionId,
      contractKind: "relief_convoys",
      outcome: "success",
      pressureDelta: -5,
      recoveryDelta: -4,
      trustDelta: 1,
      runtimeActionId: "action_stabilize_supply_lanes",
      runtimeSpent: { wealth: 10, materials: 8 },
    }),
  );

  ps.worldConsequences[0]!.createdAt = recentCommitAt;

  const runtime = buildWorldConsequenceActionRuntimeView(ps, "action_stabilize_supply_lanes", [
    { id: "action_stabilize_supply_lanes", title: "Fund stabilization" },
    { id: "action_faction_stability", title: "Fund civic response" },
  ]);

  assert.equal(runtime.executable, false);
  assert.equal(runtime.affordability, "cooldown_active");
  assert.equal(runtime.buttonLabel, "Cooling down");
  assert.equal(runtime.lastCommittedAt, recentCommitAt);
  assert.equal(runtime.successfulCommitCount, 1);
  assert.equal(runtime.lastReceiptSummary, ps.worldConsequences[0]?.summary);
  assert.deepEqual(runtime.lastSpent, { wealth: 10, materials: 8 });
  assert.ok((runtime.cooldownMsRemaining ?? 0) > 0);
  assert.ok((runtime.cooldownMsRemaining ?? 0) <= WORLD_CONSEQUENCE_ACTION_COOLDOWN_MS);
  assert.equal(runtime.readyAt, new Date(new Date(recentCommitAt).getTime() + WORLD_CONSEQUENCE_ACTION_COOLDOWN_MS).toISOString());
  assert.ok(runtime.note.includes("will be ready again"));
  assert.deepEqual(runtime.availableFollowupActionIds, ["action_faction_stability"]);
  assert.equal(runtime.recommendedFollowupActionId, "action_faction_stability");
});

test("insufficient-resource runtime view reports shortfall and withholds post-commit preview", () => {
  const ps = getOrCreatePlayerState("world_consequence_runtime_shortfall_player");
  ps.resources.wealth = 7;
  ps.resources.unity = 3;

  const runtime = buildWorldConsequenceActionRuntimeView(ps, "action_faction_stability");

  assert.equal(runtime.executable, false);
  assert.equal(runtime.affordability, "insufficient_resources");
  assert.deepEqual(runtime.cost, { wealth: 8, unity: 6 });
  assert.deepEqual(runtime.shortfall, { wealth: 1, unity: 3 });
  assert.equal(runtime.remainingAfterCost, undefined);
  assert.equal(runtime.postCommitState, undefined);
  assert.ok(runtime.note.includes("wealth 1"));
  assert.ok(runtime.note.includes("unity 3"));
});
