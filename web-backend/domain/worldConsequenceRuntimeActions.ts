//web-backend/domain/worldConsequenceRuntimeActions.ts

import type { GameEvent, PlayerState, Resources } from "../gameState";
import type { RegionId } from "./world";
import { buildRecoveryContractWorldConsequence, pushWorldConsequence } from "./worldConsequences";
import { buildWorldConsequenceActionRuntimeView, deriveWorldConsequenceActions, getWorldConsequenceRuntimePlan, type WorldConsequenceActionItem } from "./worldConsequenceActions";

export interface WorldConsequenceActionExecutionResult {
  ok: boolean;
  status: "ok" | "unknown_action" | "not_executable" | "insufficient_resources" | "cooldown_active";
  message: string;
  action?: WorldConsequenceActionItem;
  spent?: Partial<Resources>;
  shortfall?: Partial<Resources>;
  readyAt?: string;
  cooldownMsRemaining?: number;
  regionId?: string | null;
  receiptId?: string;
  appliedEffect?: {
    pressureDelta: number;
    recoveryDelta: number;
    trustDelta: number;
    controlDelta: number;
    threatDelta: number;
    summary: string;
  };
}

function fallbackAction(actionId: string, ps: PlayerState): WorldConsequenceActionItem | null {
  if (getWorldConsequenceRuntimePlan(actionId) == null) return null;
  const regionId = actionId.startsWith("action_region_") ? actionId.replace("action_region_", "") : ps.city.regionId;
  if (actionId === "action_stabilize_supply_lanes") {
    return {
      id: actionId, audience: "player", lane: "economy", priority: "high",
      title: "Stabilize supply lanes before scarcity hardens",
      summary: "Fallback execution path for a real runtime action.",
      recommendedMoves: [], sourceRegionId: regionId, sourceHook: "fallback",
    };
  }
  if (actionId === "action_faction_stability") {
    return {
      id: actionId, audience: "player", lane: "faction", priority: "high",
      title: "Repair faction stability before local pressure turns political",
      summary: "Fallback execution path for a real runtime action.",
      recommendedMoves: [], sourceRegionId: regionId, sourceHook: "fallback",
    };
  }
  if (actionId === "action_cartel_pressure") {
    return {
      id: actionId, audience: "player", lane: "cartel", priority: "high",
      title: "Cartel attention is active on your consequence trail",
      summary: "Fallback execution path for a real runtime action.",
      recommendedMoves: [], sourceRegionId: regionId, sourceHook: "fallback",
    };
  }
  if (actionId === "action_black_market_window_contain") {
    return {
      id: actionId, audience: "player", lane: "black_market", priority: "high",
      title: "Contain black-market heat before it bites back",
      summary: "Fallback execution path for a real runtime action.",
      recommendedMoves: [], sourceRegionId: regionId, sourceHook: "fallback",
    };
  }
  return {
    id: actionId, audience: "player", lane: "regional", priority: "high",
    title: `Region ${regionId} is carrying the hottest consequence load`,
    summary: "Fallback execution path for a real runtime action.",
    recommendedMoves: [], sourceRegionId: regionId, sourceHook: "fallback",
  };
}

function canAfford(resources: Resources, spent: Partial<Resources>): boolean {
  return Object.entries(spent).every(([key, value]) => Number(resources[key as keyof Resources] ?? 0) >= Number(value ?? 0));
}

function spend(resources: Resources, spent: Partial<Resources>): void {
  for (const [key, value] of Object.entries(spent)) {
    const typedKey = key as keyof Resources;
    resources[typedKey] = Math.max(0, Number(resources[typedKey] ?? 0) - Number(value ?? 0));
  }
}

function clampStat(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function isRegionId(value: string | null | undefined): value is RegionId {
  return typeof value === "string" && value.length > 0;
}

export function executeWorldConsequenceAction(ps: PlayerState, actionId: string): WorldConsequenceActionExecutionResult {
  const actions = deriveWorldConsequenceActions(ps);
  const action = actions.playerActions.find((entry) => entry.id === actionId) ?? fallbackAction(actionId, ps);
  if (!action) {
    return { ok: false, status: "unknown_action", message: "That consequence action is no longer available." };
  }

  const plan = getWorldConsequenceRuntimePlan(action.id);
  if (!plan) {
    return {
      ok: false,
      status: "not_executable",
      message: "That action is still advisory-only. The panel can describe it, but runtime cannot execute it yet.",
      action,
    };
  }

  const runtime = buildWorldConsequenceActionRuntimeView(ps, action.id);
  if (!runtime.executable && runtime.affordability === "cooldown_active") {
    return {
      ok: false,
      status: "cooldown_active",
      message: runtime.note,
      action: { ...action, runtime },
      spent: plan.spent,
      readyAt: runtime.readyAt,
      cooldownMsRemaining: runtime.cooldownMsRemaining,
      regionId: action.sourceRegionId,
    };
  }

  if (!canAfford(ps.resources, plan.spent)) {
    return {
      ok: false,
      status: "insufficient_resources",
      message: "Not enough city resources to commit that response right now.",
      action: { ...action, runtime },
      spent: plan.spent,
      shortfall: runtime.shortfall,
      regionId: action.sourceRegionId,
    };
  }

  spend(ps.resources, plan.spent);
  ps.city.stats.unity = clampStat(Number(ps.city.stats.unity ?? 0) + plan.trustDelta);
  ps.cityStress.threatPressure = clampStat(Number(ps.cityStress.threatPressure ?? 0) + plan.pressureDelta);
  ps.cityStress.recoveryBurden = clampStat(Number(ps.cityStress.recoveryBurden ?? 0) + plan.recoveryDelta);
  ps.cityStress.unityPressure = clampStat(Number(ps.cityStress.unityPressure ?? 0) - Math.max(1, Math.round(plan.trustDelta * 0.6)));
  ps.cityStress.total = clampStat(Number(ps.cityStress.total ?? 0) + Math.round(plan.pressureDelta * 0.35 + plan.recoveryDelta * 0.35 - plan.trustDelta * 0.2));

  const entry = buildRecoveryContractWorldConsequence({
    missionId: `world_action_${Date.now()}`,
    missionTitle: action.title,
    regionId: action.sourceRegionId ?? ps.city.regionId,
    contractKind: plan.contractKind,
    outcome: "success",
    pressureDelta: plan.pressureDelta,
    recoveryDelta: plan.recoveryDelta,
    trustDelta: plan.trustDelta,
    runtimeActionId: action.id,
    runtimeSpent: plan.spent,
  });

  entry.title = `Response action executed: ${action.title}`;
  entry.summary = `${plan.summaryNote} Costs committed: ${Object.entries(plan.spent).map(([key, value]) => `${key} ${value}`).join(", ")}.`;
  entry.detail = `Player-facing world consequence guidance is no longer text only for this lane. The city committed a bounded runtime response in ${action.sourceRegionId ?? ps.city.regionId}, which should cool propagated pressure instead of merely narrating it.`;
  entry.metrics.controlDelta = plan.controlDelta ?? entry.metrics.controlDelta;
  entry.metrics.threatDelta = plan.threatDelta ?? entry.metrics.threatDelta;

  const persistedReceipt = pushWorldConsequence(ps, entry);
  const eventRegionId = isRegionId(action.sourceRegionId) ? action.sourceRegionId : ps.city.regionId;
  const responseEvent: GameEvent = {
    id: `evt_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    timestamp: new Date().toISOString(),
    kind: "city_stress_change",
    message: `${action.title} resolved as a bounded city response.`,
    regionId: eventRegionId,
  };
  ps.eventLog = [...(ps.eventLog ?? []), responseEvent].slice(-60);

  return {
    ok: true,
    status: "ok",
    message: `${action.title} executed. Propagated pressure should now cool instead of just being admired from a safe distance.`,
    action,
    spent: plan.spent,
    regionId: action.sourceRegionId ?? ps.city.regionId,
    receiptId: persistedReceipt?.id,
    appliedEffect: {
      pressureDelta: entry.metrics.pressureDelta,
      recoveryDelta: entry.metrics.recoveryDelta,
      trustDelta: plan.trustDelta,
      controlDelta: entry.metrics.controlDelta,
      threatDelta: entry.metrics.threatDelta,
      summary: plan.summaryNote,
    },
  };
}

export function isExecutableWorldConsequenceAction(ps: PlayerState, action: WorldConsequenceActionItem): boolean {
  return buildWorldConsequenceActionRuntimeView(ps, action.id).executable;
}
