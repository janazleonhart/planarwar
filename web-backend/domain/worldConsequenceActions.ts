//web-backend/domain/worldConsequenceActions.ts

import type { PlayerState, Resources } from "../gameState";
import type { WorldConsequenceState } from "./worldConsequences";
import type { WorldConsequenceHooksView } from "./worldConsequenceHooks";
import { deriveWorldConsequenceHooks } from "./worldConsequenceHooks";

export type WorldConsequenceActionPriority = "watch" | "high" | "critical";
export type WorldConsequenceActionAudience = "player" | "admin" | "mother_brain";
export type WorldConsequenceActionLane = "economy" | "black_market" | "cartel" | "faction" | "regional" | "observability";

export interface RuntimeWorldConsequenceActionPlan {
  contractKind: "stabilize_district" | "repair_works" | "relief_convoys" | "counter_rumors";
  spent: Partial<Resources>;
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
}

export interface WorldConsequenceActionItem {
  id: string;
  audience: WorldConsequenceActionAudience;
  lane: WorldConsequenceActionLane;
  priority: WorldConsequenceActionPriority;
  title: string;
  summary: string;
  recommendedMoves: string[];
  sourceRegionId: string | null;
  sourceHook: string;
  runtime?: WorldConsequenceActionRuntimeView;
}

export interface WorldConsequenceActionsView {
  headline: string;
  recommendedPrimaryAction: string;
  playerActions: WorldConsequenceActionItem[];
  adminActions: WorldConsequenceActionItem[];
  motherBrainActions: WorldConsequenceActionItem[];
}



export const WORLD_CONSEQUENCE_ACTION_COOLDOWN_MS = 10 * 60 * 1000;

function summarizeRuntimeActionHistory(ps: PlayerState, actionId: string): { lastCommittedAt?: string; successfulCommitCount: number } {
  const receipts = ps.worldConsequences ?? [];
  let lastCommittedAt: string | undefined;
  let successfulCommitCount = 0;
  for (const entry of receipts) {
    if (entry.source !== "recovery_contract") continue;
    if (entry.runtimeActionId !== actionId) continue;
    if (entry.outcome !== "success") continue;
    successfulCommitCount += 1;
    if (!lastCommittedAt) lastCommittedAt = entry.createdAt;
  }
  return { lastCommittedAt, successfulCommitCount };
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

function canAffordAction(resources: Resources, spent: Partial<Resources>): boolean {
  return Object.keys(getActionShortfall(resources, spent)).length === 0;
}

function runtimeButtonLabel(actionId: string, affordability?: WorldConsequenceActionRuntimeView["affordability"]): string {
  if (affordability === "cooldown_active") return "Cooling down";
  if (actionId === "action_stabilize_supply_lanes") return "Fund stabilization";
  if (actionId === "action_faction_stability") return "Fund civic response";
  if (actionId === "action_cartel_pressure" || actionId === "action_black_market_window_contain") return "Fund containment";
  if (actionId.startsWith("action_region_")) return "Dispatch response";
  return "Advisory only";
}

function buildRuntimeEffectPreview(plan: RuntimeWorldConsequenceActionPlan): WorldConsequenceActionRuntimeEffectPreview {
  return {
    pressureDelta: plan.pressureDelta,
    recoveryDelta: plan.recoveryDelta,
    trustDelta: plan.trustDelta,
    controlDelta: plan.controlDelta ?? 0,
    threatDelta: plan.threatDelta ?? 0,
    summary: plan.summaryNote,
  };
}

export function buildWorldConsequenceActionRuntimeView(ps: PlayerState, actionId: string): WorldConsequenceActionRuntimeView {
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
      : `This lane is real, but the city still lacks ${Object.entries(shortfall).map(([key, value]) => `${key} ${value}`).join(", ")} to commit it.`,
    effect: buildRuntimeEffectPreview(plan),
    lastCommittedAt: history.lastCommittedAt,
    successfulCommitCount: history.successfulCommitCount,
  };
}
function pushUnique(target: WorldConsequenceActionItem[], item: WorldConsequenceActionItem) {
  if (!target.some((existing) => existing.id === item.id)) target.push(item);
}

function comparePriority(a: WorldConsequenceActionPriority, b: WorldConsequenceActionPriority): number {
  const order: Record<WorldConsequenceActionPriority, number> = { critical: 3, high: 2, watch: 1 };
  return order[b] - order[a];
}

function sorted(items: WorldConsequenceActionItem[]): WorldConsequenceActionItem[] {
  return [...items].sort((a, b) => {
    const prio = comparePriority(a.priority, b.priority);
    if (prio !== 0) return prio;
    return a.title.localeCompare(b.title);
  });
}

export function deriveWorldConsequenceActions(
  ps: PlayerState,
  state?: WorldConsequenceState | null,
  hooksArg?: WorldConsequenceHooksView | null,
): WorldConsequenceActionsView {
  const hooks = hooksArg ?? deriveWorldConsequenceHooks(ps, state);
  const propagated = state ?? ps.worldConsequenceState ?? null;
  const hottestRegion = hooks.hotspots[0]?.regionId ?? hooks.summary.topRegionIds[0] ?? null;

  const playerActions: WorldConsequenceActionItem[] = [];
  const adminActions: WorldConsequenceActionItem[] = [];
  const motherBrainActions: WorldConsequenceActionItem[] = [];

  if (!propagated || (propagated.summary?.totalLedgerEntries ?? 0) <= 0) {
    const quiet: WorldConsequenceActionItem = {
      id: "action_observe_until_pressure_is_real",
      audience: "player",
      lane: "observability",
      priority: "watch",
      title: "Keep observing until exported pressure is real",
      summary: "Mother Brain is receiving the seam, but the city has not generated a meaningful world consequence trail yet.",
      recommendedMoves: [
        "Let at least one setback or recovery contract fully resolve.",
        "Refresh the Mother Brain page and confirm the ledger count rises above zero.",
      ],
      sourceRegionId: hottestRegion,
      sourceHook: "summary",
    };
    const quietWithRuntime = { ...quiet, runtime: buildWorldConsequenceActionRuntimeView(ps, quiet.id) };
    return {
      headline: "No actionable world-consequence pressure yet.",
      recommendedPrimaryAction: quiet.title,
      playerActions: [quietWithRuntime],
      adminActions: [],
      motherBrainActions: [],
    };
  }

  if (hooks.worldEconomy.riskTier === "active" || hooks.worldEconomy.riskTier === "severe") {
    const priority: WorldConsequenceActionPriority = hooks.worldEconomy.riskTier === "severe" ? "critical" : "high";
    pushUnique(playerActions, {
      id: "action_stabilize_supply_lanes",
      audience: "player",
      lane: "economy",
      priority,
      title: "Stabilize supply lanes before scarcity hardens",
      summary: "Trade disruption and supply friction are high enough to spill back into city pressure if left alone.",
      recommendedMoves: [
        "Favor recovery or logistics contracts over greedier mission picks for a cycle.",
        "Keep public services and essentials supplied so economy pressure does not echo into fresh setbacks.",
      ],
      sourceRegionId: hottestRegion,
      sourceHook: "worldEconomy",
    });
    pushUnique(adminActions, {
      id: "admin_watch_trade_pressure",
      audience: "admin",
      lane: "economy",
      priority,
      title: "Watch economy pressure and scarcity-facing systems",
      summary: "The world economy hook is live enough that downstream scarcity, route strain, or merchant throttling should be considered expected behavior.",
      recommendedMoves: [
        "Confirm vendor and route-facing systems are not contradicting the propagated pressure state.",
        "Audit whether future economy consumers should read the same consequence hook instead of inventing a parallel signal.",
      ],
      sourceRegionId: hottestRegion,
      sourceHook: "worldEconomy",
    });
  }

  if (hooks.blackMarket.status === "opening" && !hooks.blackMarket.unlocked) {
    pushUnique(playerActions, {
      id: "action_black_market_opening_locked",
      audience: "player",
      lane: "black_market",
      priority: "watch",
      title: "A black-market seam is opening, but the city cannot exploit it yet",
      summary: "Pressure is creating illicit opportunity, but the city still lacks the unlock or doctrine to act on it.",
      recommendedMoves: [
        "Treat this as a warning, not free money.",
        "Either unlock the lane later or contain the conditions creating the opening now.",
      ],
      sourceRegionId: hooks.blackMarket.driverRegionId,
      sourceHook: "blackMarket",
    });
  }

  if (hooks.blackMarket.status === "active" || hooks.blackMarket.status === "surging") {
    const priority: WorldConsequenceActionPriority = hooks.blackMarket.status === "surging" ? "critical" : "high";
    const exploit = hooks.blackMarket.recommendedPosture === "exploit" || hooks.blackMarket.recommendedPosture === "probe";
    pushUnique(playerActions, {
      id: exploit ? "action_black_market_window_exploit" : "action_black_market_window_contain",
      audience: "player",
      lane: "black_market",
      priority,
      title: exploit ? "A real black-market window is open" : "Contain black-market heat before it bites back",
      summary: exploit
        ? "Illicit opportunity is live enough to be a strategic choice instead of flavor text."
        : "Opportunity exists, but heat is high enough that careless use invites cartel teeth.",
      recommendedMoves: exploit
        ? [
            "Use the opening deliberately and keep an eye on cartel attention rather than pretending this is free upside.",
            "Bias missions toward the hottest region only if you can absorb the civic and recovery fallout.",
          ]
        : [
            "Reduce pressure in the driver region before leaning harder into illicit routes.",
            "Treat black-market activity as a temporary pressure valve, not your new religion.",
          ],
      sourceRegionId: hooks.blackMarket.driverRegionId,
      sourceHook: "blackMarket",
    });
  }

  if (hooks.cartel.pressureTier === "active" || hooks.cartel.pressureTier === "severe") {
    const priority: WorldConsequenceActionPriority = hooks.cartel.pressureTier === "severe" ? "critical" : "high";
    pushUnique(playerActions, {
      id: "action_cartel_pressure",
      audience: "player",
      lane: "cartel",
      priority,
      title: "Cartel attention is active on your consequence trail",
      summary: "Route pressure and illicit openings are attracting cartel behavior that will punish sloppy recovery choices.",
      recommendedMoves: [
        "Protect essentials first; luxury recovery can wait.",
        "Do not stack more heat in the hottest region unless you actually want a harder world response.",
      ],
      sourceRegionId: hottestRegion,
      sourceHook: "cartel",
    });
    pushUnique(adminActions, {
      id: "admin_cartel_observability",
      audience: "admin",
      lane: "cartel",
      priority,
      title: "Track cartel attention as a real downstream consumer candidate",
      summary: "The cartel hook is strong enough to justify future runtime consumers and admin audits instead of leaving it as passive telemetry.",
      recommendedMoves: [
        "Confirm logs and dashboards surface cartel pressure alongside black-market opportunity.",
        "Queue any future cartel runtime work to consume this hook directly rather than rebuilding the math elsewhere.",
      ],
      sourceRegionId: hottestRegion,
      sourceHook: "cartel",
    });
  }

  if (hooks.faction.responseBias === "watch" || hooks.faction.responseBias === "fracture_risk") {
    const priority: WorldConsequenceActionPriority = hooks.faction.responseBias === "fracture_risk" ? "critical" : "high";
    pushUnique(playerActions, {
      id: "action_faction_stability",
      audience: "player",
      lane: "faction",
      priority,
      title: "Repair faction stability before local pressure turns political",
      summary: "Faction drift is no longer quiet, which means recovery choices should favor stability instead of raw extraction.",
      recommendedMoves: [
        "Prefer unity-positive or recovery-positive outcomes for a cycle.",
        "Avoid stacking fresh setbacks in already hot regions while faction posture is wobbling.",
      ],
      sourceRegionId: hottestRegion,
      sourceHook: "faction",
    });
    pushUnique(motherBrainActions, {
      id: "mb_prioritize_unstable_regions",
      audience: "mother_brain",
      lane: "faction",
      priority,
      title: "Prioritize unstable regions in consequence-aware observation",
      summary: "Faction posture has drifted far enough that Mother Brain should keep unstable regions visible in reporting and future goal packs.",
      recommendedMoves: [
        "Keep the hottest region near the top of summaries and smoke coverage.",
        "Do not mutate the world from this alone yet; remain observe-only and auditable.",
      ],
      sourceRegionId: hottestRegion,
      sourceHook: "faction",
    });
  }

  if (hooks.hotspots.length > 0) {
    const hotspot = hooks.hotspots[0]!;
    pushUnique(playerActions, {
      id: `action_region_${hotspot.regionId}`,
      audience: "player",
      lane: "regional",
      priority: hotspot.blackMarketHeat >= 10 || hotspot.tradeDisruption >= 8 ? "high" : "watch",
      title: `Region ${hotspot.regionId} is carrying the hottest consequence load`,
      summary: hotspot.note,
      recommendedMoves: [
        `Watch ${hotspot.regionId} first when choosing where to absorb or relieve pressure.`,
        "Use the hotspot list as a targeting aid, not a commandment carved into stone.",
      ],
      sourceRegionId: hotspot.regionId,
      sourceHook: "hotspot",
    });
  }

  if ((propagated.summary?.totalLedgerEntries ?? 0) > 0) {
    pushUnique(adminActions, {
      id: "admin_validate_signal_visibility",
      audience: "admin",
      lane: "observability",
      priority: hooks.summary.hasActiveHooks ? "high" : "watch",
      title: "Keep consequence visibility aligned across player, admin, and Mother Brain surfaces",
      summary: "The seam is live now, so stale dashboards or silent logs become a trust problem instead of a cosmetic one.",
      recommendedMoves: [
        "Confirm /api/me, world consequence routes, and Mother Brain snapshot all describe the same pressure story.",
        "When logs are quiet, verify whether the city simply has no live pressure instead of assuming the seam is broken.",
      ],
      sourceRegionId: hottestRegion,
      sourceHook: "summary",
    });
  }

  const sortedPlayer = sorted(playerActions).slice(0, 5).map((item) => ({ ...item, runtime: buildWorldConsequenceActionRuntimeView(ps, item.id) }));
  const sortedAdmin = sorted(adminActions).slice(0, 5);
  const sortedMotherBrain = sorted(motherBrainActions).slice(0, 5);
  const recommendedPrimaryAction = sortedPlayer[0]?.title ?? sortedAdmin[0]?.title ?? sortedMotherBrain[0]?.title ?? "Keep observing";
  const headline =
    sortedPlayer[0]?.summary ??
    sortedAdmin[0]?.summary ??
    sortedMotherBrain[0]?.summary ??
    "World consequence pressure is visible, but no action lane is urgent yet.";

  return {
    headline,
    recommendedPrimaryAction,
    playerActions: sortedPlayer,
    adminActions: sortedAdmin,
    motherBrainActions: sortedMotherBrain,
  };
}
