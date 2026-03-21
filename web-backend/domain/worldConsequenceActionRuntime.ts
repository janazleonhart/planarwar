//web-backend/domain/worldConsequenceActionRuntime.ts

import type { PlayerState, Resources } from "../gameState";

export interface RuntimeWorldConsequenceActionPlan {
  contractKind: "stabilize_district" | "repair_works" | "relief_convoys" | "counter_rumors";
  spent: Partial<Resources>;
  grants?: Partial<Resources>;
  pressureDelta: number;
  recoveryDelta: number;
  trustDelta: number;
  controlDelta?: number;
  threatDelta?: number;
  summaryNote: string;
}

export interface WorldConsequenceActionRuntimeEffectPreview {
  pressureDelta: number;
  recoveryDelta: number;
  trustDelta: number;
  controlDelta: number;
  threatDelta: number;
  grants?: Partial<Resources>;
  summary: string;
}

export interface WorldConsequenceActionRuntimeView {
  executable: boolean;
  affordability: "affordable" | "insufficient_resources" | "cooldown_active" | "advisory_only";
  buttonLabel: string;
  cost: Partial<Resources>;
  shortfall?: Partial<Resources>;
  note: string;
  effect?: WorldConsequenceActionRuntimeEffectPreview;
  cooldownMsRemaining?: number;
  readyAt?: string;
  lastCommittedAt?: string;
  successfulCommitCount?: number;
  lastReceiptId?: string;
  lastReceiptSummary?: string;
  lastAppliedEffect?: {
    pressureDelta: number;
    recoveryDelta: number;
    controlDelta: number;
    threatDelta: number;
  };
  lastSpent?: Partial<Resources>;
  remainingAfterCost?: Partial<Resources>;
  blockedFollowupActionIds?: string[];
  blockedFollowupActionTitles?: string[];
  availableFollowupActionIds?: string[];
  availableFollowupActionTitles?: string[];
  recommendedFollowupActionId?: string;
  recommendedFollowupActionTitle?: string;
  postCommitState?: {
    currentStage: "stable" | "strained" | "crisis" | "lockdown";
    stage: "stable" | "strained" | "crisis" | "lockdown";
    stageChanged: boolean;
    unity: number;
    threatPressure: number;
    recoveryBurden: number;
    unityPressure: number;
    total: number;
  };
}

export interface WorldConsequenceActionRuntimeCandidate {
  id: string;
  title: string;
}

export const WORLD_CONSEQUENCE_ACTION_COOLDOWN_MS = 10 * 60 * 1000;

function summarizeRuntimeActionHistory(
  ps: PlayerState,
  actionId: string,
): {
  lastCommittedAt?: string;
  successfulCommitCount: number;
  lastReceiptId?: string;
  lastReceiptSummary?: string;
  lastAppliedEffect?: {
    pressureDelta: number;
    recoveryDelta: number;
    controlDelta: number;
    threatDelta: number;
  };
  lastSpent?: Partial<Resources>;
} {
  const receipts = ps.worldConsequences ?? [];
  let lastCommittedAt: string | undefined;
  let successfulCommitCount = 0;
  let lastReceiptId: string | undefined;
  let lastReceiptSummary: string | undefined;
  let lastAppliedEffect:
    | {
        pressureDelta: number;
        recoveryDelta: number;
        controlDelta: number;
        threatDelta: number;
      }
    | undefined;
  let lastSpent: Partial<Resources> | undefined;

  for (const entry of receipts) {
    if (entry.source !== "recovery_contract") continue;
    if (entry.runtimeActionId !== actionId) continue;
    if (entry.outcome !== "success") continue;

    successfulCommitCount += 1;

    if (!lastCommittedAt) {
      lastCommittedAt = entry.createdAt;
      lastReceiptId = entry.id;
      lastReceiptSummary = entry.summary;
      lastAppliedEffect = {
        pressureDelta: entry.metrics.pressureDelta,
        recoveryDelta: entry.metrics.recoveryDelta,
        controlDelta: entry.metrics.controlDelta,
        threatDelta: entry.metrics.threatDelta,
      };
      lastSpent = entry.runtimeSpent;
    }
  }

  return {
    lastCommittedAt,
    successfulCommitCount,
    lastReceiptId,
    lastReceiptSummary,
    lastAppliedEffect,
    lastSpent,
  };
}

export function getWorldConsequenceRuntimePlan(actionId: string): RuntimeWorldConsequenceActionPlan | null {
  if (actionId === "action_stabilize_supply_lanes") {
    return {
      contractKind: "relief_convoys",
      spent: { wealth: 10, materials: 8 },
      pressureDelta: -5,
      recoveryDelta: -4,
      trustDelta: 1,
      controlDelta: 1,
      threatDelta: -2,
      summaryNote: "Supply convoys and route escorts were funded to cool scarcity pressure.",
    };
  }

  if (actionId === "action_faction_stability") {
    return {
      contractKind: "counter_rumors",
      spent: { wealth: 8, unity: 6 },
      pressureDelta: -3,
      recoveryDelta: -2,
      trustDelta: 6,
      controlDelta: 1,
      threatDelta: -1,
      summaryNote: "A civic stabilization push was funded to stop local strain turning political.",
    };
  }

  if (actionId === "action_cartel_pressure" || actionId === "action_black_market_window_contain") {
    return {
      contractKind: "repair_works",
      spent: { wealth: 9, materials: 7, unity: 2 },
      pressureDelta: -4,
      recoveryDelta: -3,
      trustDelta: 2,
      controlDelta: 1,
      threatDelta: -2,
      summaryNote: "Containment teams were funded to cool illicit heat before it hardened into retaliation.",
    };
  }

  if (actionId === "action_black_market_window_exploit") {
    return {
      contractKind: "counter_rumors",
      spent: { food: 3, materials: 2, unity: 1 },
      grants: { wealth: 14, knowledge: 2 },
      pressureDelta: 4,
      recoveryDelta: 2,
      trustDelta: -2,
      controlDelta: -1,
      threatDelta: 3,
      summaryNote: "A shadow-market window was exploited for fast profit, trading civic stability for illicit upside.",
    };
  }

  if (actionId.startsWith("action_region_")) {
    return {
      contractKind: "stabilize_district",
      spent: { wealth: 8, materials: 6, unity: 4 },
      pressureDelta: -4,
      recoveryDelta: -3,
      trustDelta: 3,
      controlDelta: 2,
      threatDelta: -2,
      summaryNote: "District recovery crews were dispatched into the hottest region.",
    };
  }

  return null;
}

function getActionShortfall(resources: Resources, spent: Partial<Resources>): Partial<Resources> {
  const shortfall: Partial<Resources> = {};
  for (const [key, value] of Object.entries(spent)) {
    const typedKey = key as keyof Resources;
    const missing = Math.max(0, Number(value ?? 0) - Number(resources[typedKey] ?? 0));
    if (missing > 0) shortfall[typedKey] = missing;
  }
  return shortfall;
}

function getRemainingAfterCost(resources: Resources, spent: Partial<Resources>): Partial<Resources> {
  const remaining: Partial<Resources> = {};
  for (const [key, value] of Object.entries(spent)) {
    const typedKey = key as keyof Resources;
    remaining[typedKey] = Math.max(0, Number(resources[typedKey] ?? 0) - Number(value ?? 0));
  }
  return remaining;
}

function getHypotheticalResourcesAfterCost(resources: Resources, spent: Partial<Resources>): Resources {
  return {
    ...resources,
    food: Math.max(0, Number(resources.food ?? 0) - Number(spent.food ?? 0)),
    materials: Math.max(0, Number(resources.materials ?? 0) - Number(spent.materials ?? 0)),
    wealth: Math.max(0, Number(resources.wealth ?? 0) - Number(spent.wealth ?? 0)),
    mana: Math.max(0, Number(resources.mana ?? 0) - Number(spent.mana ?? 0)),
    knowledge: Math.max(0, Number(resources.knowledge ?? 0) - Number(spent.knowledge ?? 0)),
    unity: Math.max(0, Number(resources.unity ?? 0) - Number(spent.unity ?? 0)),
  };
}

function clampPreviewStat(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function derivePreviewStage(total: number): "stable" | "strained" | "crisis" | "lockdown" {
  if (total < 25) return "stable";
  if (total < 50) return "strained";
  if (total < 75) return "crisis";
  return "lockdown";
}

function getUnityPressureDeltaFromTrust(trustDelta: number): number {
  if (trustDelta > 0) return -Math.max(1, Math.round(trustDelta * 0.6));
  if (trustDelta < 0) return Math.max(1, Math.round(Math.abs(trustDelta) * 0.6));
  return 0;
}

function buildPostCommitStatePreview(ps: PlayerState, plan: RuntimeWorldConsequenceActionPlan) {
  const unityPressureDelta = getUnityPressureDeltaFromTrust(plan.trustDelta);
  const total = clampPreviewStat(
    Number(ps.cityStress.total ?? 0) +
      Math.round(plan.pressureDelta * 0.35 + plan.recoveryDelta * 0.35 - plan.trustDelta * 0.2),
  );
  const currentStage = (ps.cityStress.stage ?? derivePreviewStage(Number(ps.cityStress.total ?? 0))) as
    | "stable"
    | "strained"
    | "crisis"
    | "lockdown";
  const stage = derivePreviewStage(total);
  return {
    currentStage,
    stage,
    stageChanged: currentStage !== stage,
    unity: clampPreviewStat(Number(ps.city.stats.unity ?? 0) + plan.trustDelta),
    threatPressure: clampPreviewStat(Number(ps.cityStress.threatPressure ?? 0) + plan.pressureDelta),
    recoveryBurden: clampPreviewStat(Number(ps.cityStress.recoveryBurden ?? 0) + plan.recoveryDelta),
    unityPressure: clampPreviewStat(Number(ps.cityStress.unityPressure ?? 0) + unityPressureDelta),
    total,
  };
}

function runtimeButtonLabel(
  actionId: string,
  affordability?: WorldConsequenceActionRuntimeView["affordability"],
): string {
  if (affordability === "cooldown_active") return "Cooling down";
  if (actionId === "action_stabilize_supply_lanes") return "Fund stabilization";
  if (actionId === "action_faction_stability") return "Fund civic response";
  if (actionId === "action_cartel_pressure" || actionId === "action_black_market_window_contain") {
    return "Fund containment";
  }
  if (actionId === "action_black_market_window_exploit") return "Exploit window";
  if (actionId.startsWith("action_region_")) return "Dispatch response";
  return "Advisory only";
}

function buildRuntimeEffectPreview(
  plan: RuntimeWorldConsequenceActionPlan,
): WorldConsequenceActionRuntimeEffectPreview {
  return {
    pressureDelta: plan.pressureDelta,
    recoveryDelta: plan.recoveryDelta,
    trustDelta: plan.trustDelta,
    controlDelta: plan.controlDelta ?? 0,
    threatDelta: plan.threatDelta ?? 0,
    grants: plan.grants,
    summary: plan.summaryNote,
  };
}

function getFollowupActionOutcomes(
  ps: PlayerState,
  actionId: string,
  candidates: WorldConsequenceActionRuntimeCandidate[],
): {
  blockedIds: string[];
  blockedTitles: string[];
  availableIds: string[];
  availableTitles: string[];
  recommendedId?: string;
  recommendedTitle?: string;
} | undefined {
  const plan = getWorldConsequenceRuntimePlan(actionId);
  if (!plan) return undefined;

  const hypotheticalResources = getHypotheticalResourcesAfterCost(ps.resources, plan.spent);
  const blockedIds: string[] = [];
  const blockedTitles: string[] = [];
  const availableIds: string[] = [];
  const availableTitles: string[] = [];

  for (const candidate of candidates) {
    if (candidate.id === actionId) continue;
    const candidatePlan = getWorldConsequenceRuntimePlan(candidate.id);
    if (!candidatePlan) continue;

    const history = summarizeRuntimeActionHistory(ps, candidate.id);
    if (history.lastCommittedAt) {
      const readyAtMs = new Date(history.lastCommittedAt).getTime() + WORLD_CONSEQUENCE_ACTION_COOLDOWN_MS;
      if (Math.max(0, readyAtMs - Date.now()) > 0) continue;
    }

    const currentShortfall = getActionShortfall(ps.resources, candidatePlan.spent);
    const hypotheticalShortfall = getActionShortfall(hypotheticalResources, candidatePlan.spent);
    if (Object.keys(currentShortfall).length === 0 && Object.keys(hypotheticalShortfall).length > 0) {
      blockedIds.push(candidate.id);
      blockedTitles.push(candidate.title);
    } else if (Object.keys(currentShortfall).length === 0 && Object.keys(hypotheticalShortfall).length === 0) {
      availableIds.push(candidate.id);
      availableTitles.push(candidate.title);
    }
  }

  if (blockedIds.length === 0 && availableIds.length === 0) return undefined;
  return {
    blockedIds,
    blockedTitles,
    availableIds,
    availableTitles,
    recommendedId: availableIds[0],
    recommendedTitle: availableTitles[0],
  };
}

export function buildWorldConsequenceActionRuntimeView(
  ps: PlayerState,
  actionId: string,
  candidates: WorldConsequenceActionRuntimeCandidate[] = [],
): WorldConsequenceActionRuntimeView {
  const plan = getWorldConsequenceRuntimePlan(actionId);
  if (!plan) {
    return {
      executable: false,
      affordability: "advisory_only",
      buttonLabel: runtimeButtonLabel(actionId, "advisory_only"),
      cost: {},
      note: "This lane is still advice-only. Runtime cannot execute it yet.",
    };
  }

  const history = summarizeRuntimeActionHistory(ps, actionId);
  const followupOutcomes = getFollowupActionOutcomes(ps, actionId, candidates);
  if (history.lastCommittedAt) {
    const readyAtMs = new Date(history.lastCommittedAt).getTime() + WORLD_CONSEQUENCE_ACTION_COOLDOWN_MS;
    const cooldownMsRemaining = Math.max(0, readyAtMs - Date.now());
    if (cooldownMsRemaining > 0) {
      return {
        executable: false,
        affordability: "cooldown_active",
        buttonLabel: runtimeButtonLabel(actionId, "cooldown_active"),
        cost: plan.spent,
        note: `This lane was just committed. It will be ready again at ${new Date(readyAtMs).toISOString()}.`,
        effect: buildRuntimeEffectPreview(plan),
        cooldownMsRemaining,
        readyAt: new Date(readyAtMs).toISOString(),
        lastCommittedAt: history.lastCommittedAt,
        successfulCommitCount: history.successfulCommitCount,
        lastReceiptId: history.lastReceiptId,
        lastReceiptSummary: history.lastReceiptSummary,
        lastAppliedEffect: history.lastAppliedEffect,
        lastSpent: history.lastSpent,
        remainingAfterCost: getRemainingAfterCost(ps.resources, plan.spent),
        blockedFollowupActionIds: followupOutcomes?.blockedIds,
        blockedFollowupActionTitles: followupOutcomes?.blockedTitles,
        availableFollowupActionIds: followupOutcomes?.availableIds,
        availableFollowupActionTitles: followupOutcomes?.availableTitles,
        recommendedFollowupActionId: followupOutcomes?.recommendedId,
        recommendedFollowupActionTitle: followupOutcomes?.recommendedTitle,
        postCommitState: buildPostCommitStatePreview(ps, plan),
      };
    }
  }

  const shortfall = getActionShortfall(ps.resources, plan.spent);
  const affordable = Object.keys(shortfall).length === 0;

  return {
    executable: affordable,
    affordability: affordable ? "affordable" : "insufficient_resources",
    buttonLabel: runtimeButtonLabel(actionId, affordable ? "affordable" : "insufficient_resources"),
    cost: plan.spent,
    shortfall: affordable ? undefined : shortfall,
    note: affordable
      ? "This lane can be committed right now as a bounded runtime response."
      : `This lane is real, but the city still lacks ${Object.entries(shortfall)
          .map(([key, value]) => `${key} ${value}`)
          .join(", ")} to commit it.`,
    effect: buildRuntimeEffectPreview(plan),
    lastCommittedAt: history.lastCommittedAt,
    successfulCommitCount: history.successfulCommitCount,
    lastReceiptId: history.lastReceiptId,
    lastReceiptSummary: history.lastReceiptSummary,
    lastAppliedEffect: history.lastAppliedEffect,
    lastSpent: history.lastSpent,
    remainingAfterCost: affordable ? getRemainingAfterCost(ps.resources, plan.spent) : undefined,
    blockedFollowupActionIds: affordable ? followupOutcomes?.blockedIds : undefined,
    blockedFollowupActionTitles: affordable ? followupOutcomes?.blockedTitles : undefined,
    availableFollowupActionIds: affordable ? followupOutcomes?.availableIds : undefined,
    availableFollowupActionTitles: affordable ? followupOutcomes?.availableTitles : undefined,
    recommendedFollowupActionId: affordable ? followupOutcomes?.recommendedId : undefined,
    recommendedFollowupActionTitle: affordable ? followupOutcomes?.recommendedTitle : undefined,
    postCommitState: affordable ? buildPostCommitStatePreview(ps, plan) : undefined,
  };
}
