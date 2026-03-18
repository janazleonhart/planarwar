//web-backend/domain/worldConsequences.ts

import type { CityMudBridgeBand, CityMudBridgePosture } from "./cityMudBridge";
import type { RecoveryContractKind, ThreatFamily } from "./missions";
import type { RegionId } from "./world";
import type { PlayerState } from "../gameState";

export type WorldConsequenceSource = "mission_setback" | "recovery_contract" | "bridge_snapshot";
export type WorldConsequenceSeverity = "watch" | "pressure" | "severe";
export type WorldConsequenceAudience = "player" | "mother_brain" | "admin";
export type WorldConsequenceTag =
  | "city_pressure_export"
  | "regional_instability"
  | "recovery_load"
  | "faction_drift"
  | "trade_disruption"
  | "black_market_opening"
  | "world_economy_hook";

export interface WorldConsequenceLedgerEntry {
  id: string;
  createdAt: string;
  playerId: string;
  cityId: string;
  regionId: RegionId | string;
  source: WorldConsequenceSource;
  severity: WorldConsequenceSeverity;
  title: string;
  summary: string;
  detail: string;
  audiences: WorldConsequenceAudience[];
  tags: WorldConsequenceTag[];
  metrics: {
    pressureDelta: number;
    recoveryDelta: number;
    controlDelta: number;
    threatDelta: number;
    bridgeBand?: CityMudBridgeBand;
    bridgePosture?: CityMudBridgePosture;
  };
  missionId?: string;
  missionTitle?: string;
  threatFamily?: ThreatFamily;
  contractKind?: RecoveryContractKind;
  outcome?: "success" | "partial" | "failure";
}

export interface WorldConsequenceRegionState {
  regionId: string;
  entryCount: number;
  netPressure: number;
  netRecoveryLoad: number;
  controlDrift: number;
  threatDrift: number;
  tradeDisruption: number;
  blackMarketHeat: number;
  factionDrift: number;
  dominantSeverity: WorldConsequenceSeverity;
  lastEventAt?: string;
}

export interface WorldConsequenceWorldEconomyState {
  tradePressure: number;
  supplyFriction: number;
  cartelAttention: number;
  destabilization: number;
  outlook: "stable" | "strained" | "volatile";
}

export interface WorldConsequenceBlackMarketState {
  opportunityScore: number;
  heat: number;
  outlook: "quiet" | "active" | "surging";
}

export interface WorldConsequenceFactionPressureState {
  driftScore: number;
  instability: number;
  dominantStance: "stable" | "watch" | "destabilizing" | "fracturing";
}

export interface WorldConsequenceStateSummary {
  affectedRegionIds: string[];
  totalLedgerEntries: number;
  severeCount: number;
  destabilizationScore: number;
  note: string;
}

export interface WorldConsequenceState {
  regions: WorldConsequenceRegionState[];
  worldEconomy: WorldConsequenceWorldEconomyState;
  blackMarket: WorldConsequenceBlackMarketState;
  factionPressure: WorldConsequenceFactionPressureState;
  summary: WorldConsequenceStateSummary;
  lastUpdatedAt?: string;
}

export interface WorldConsequenceSummary {
  total: number;
  recent: WorldConsequenceLedgerEntry[];
  countsBySource: Record<WorldConsequenceSource, number>;
  countsBySeverity: Record<WorldConsequenceSeverity, number>;
  activeTags: WorldConsequenceTag[];
  topSignals: string[];
  note: string;
}

export const MAX_WORLD_CONSEQUENCE_LEDGER = 40;

function clampSeverity(value: number): WorldConsequenceSeverity {
  if (value >= 12) return "severe";
  if (value >= 5) return "pressure";
  return "watch";
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function clampNonNegative(value: number): number {
  return Math.max(0, Math.round(value));
}

function scaleSeverityWeight(severity: WorldConsequenceSeverity): number {
  switch (severity) {
    case "severe": return 3;
    case "pressure": return 2;
    default: return 1;
  }
}

function economyOutlook(score: number): WorldConsequenceWorldEconomyState["outlook"] {
  if (score >= 22) return "volatile";
  if (score >= 8) return "strained";
  return "stable";
}

function blackMarketOutlook(score: number): WorldConsequenceBlackMarketState["outlook"] {
  if (score >= 18) return "surging";
  if (score >= 6) return "active";
  return "quiet";
}

function factionStance(score: number): WorldConsequenceFactionPressureState["dominantStance"] {
  if (score >= 22) return "fracturing";
  if (score >= 8) return "destabilizing";
  if (score >= 3) return "watch";
  return "stable";
}

export function summarizeWorldConsequences(entries: WorldConsequenceLedgerEntry[]): WorldConsequenceSummary {
  const countsBySource: Record<WorldConsequenceSource, number> = {
    mission_setback: 0,
    recovery_contract: 0,
    bridge_snapshot: 0,
  };
  const countsBySeverity: Record<WorldConsequenceSeverity, number> = {
    watch: 0,
    pressure: 0,
    severe: 0,
  };

  for (const entry of entries) {
    countsBySource[entry.source] += 1;
    countsBySeverity[entry.severity] += 1;
  }

  const activeTags = unique(entries.flatMap((entry) => entry.tags)).slice(0, 8);
  const topSignals = entries
    .slice(0, 5)
    .map((entry) => `${entry.title}: ${entry.summary}`);

  let note = "No exported city consequences yet.";
  if (entries.length > 0) {
    const severeCount = countsBySeverity.severe;
    const pressureCount = countsBySeverity.pressure;
    if (severeCount > 0) {
      note = `City actions are now exporting severe world-facing signals (${severeCount} severe, ${pressureCount} pressured).`;
    } else if (pressureCount > 0) {
      note = `City actions are exporting pressured regional signals (${pressureCount} pressured entries tracked).`;
    } else {
      note = `City actions are exporting early watch-level signals (${entries.length} entries tracked).`;
    }
  }

  return {
    total: entries.length,
    recent: entries.slice(0, 10),
    countsBySource,
    countsBySeverity,
    activeTags,
    topSignals,
    note,
  };
}

export function deriveWorldConsequenceState(entries: WorldConsequenceLedgerEntry[]): WorldConsequenceState {
  const regionMap = new Map<string, WorldConsequenceRegionState>();

  let tradePressure = 0;
  let supplyFriction = 0;
  let cartelAttention = 0;
  let blackMarketOpportunity = 0;
  let blackMarketHeat = 0;
  let factionDriftScore = 0;
  let factionInstability = 0;
  let severeCount = 0;
  let lastUpdatedAt: string | undefined;

  for (const entry of entries) {
    const regionId = String(entry.regionId ?? "unknown");
    const current = regionMap.get(regionId) ?? {
      regionId,
      entryCount: 0,
      netPressure: 0,
      netRecoveryLoad: 0,
      controlDrift: 0,
      threatDrift: 0,
      tradeDisruption: 0,
      blackMarketHeat: 0,
      factionDrift: 0,
      dominantSeverity: "watch",
      lastEventAt: undefined,
    } satisfies WorldConsequenceRegionState;

    const severityWeight = scaleSeverityWeight(entry.severity);
    const pressureDelta = Number(entry.metrics?.pressureDelta ?? 0);
    const recoveryDelta = Number(entry.metrics?.recoveryDelta ?? 0);
    const controlDelta = Number(entry.metrics?.controlDelta ?? 0);
    const threatDelta = Number(entry.metrics?.threatDelta ?? 0);

    current.entryCount += 1;
    current.netPressure += pressureDelta;
    current.netRecoveryLoad += recoveryDelta;
    current.controlDrift += controlDelta;
    current.threatDrift += threatDelta;
    current.tradeDisruption += clampNonNegative(threatDelta + Math.max(0, pressureDelta * 0.5) + (entry.tags.includes("trade_disruption") ? 2 : 0));
    current.blackMarketHeat += clampNonNegative(Math.max(0, pressureDelta) + Math.max(0, recoveryDelta * 0.5) + (entry.tags.includes("black_market_opening") ? 4 : 0));
    current.factionDrift += clampNonNegative(Math.max(0, threatDelta) + Math.max(0, -controlDelta) + (entry.tags.includes("faction_drift") ? 2 : 0));
    current.dominantSeverity = severityWeight >= scaleSeverityWeight(current.dominantSeverity) ? entry.severity : current.dominantSeverity;
    current.lastEventAt = entry.createdAt;
    regionMap.set(regionId, current);

    tradePressure += clampNonNegative(current.tradeDisruption === 0 ? threatDelta : 0) + clampNonNegative(threatDelta + Math.max(0, pressureDelta * 0.4));
    supplyFriction += clampNonNegative(Math.max(0, recoveryDelta) + Math.max(0, -controlDelta));
    cartelAttention += clampNonNegative(Math.max(0, pressureDelta * 0.6) + Math.max(0, threatDelta) + (entry.tags.includes("world_economy_hook") ? 3 : 0));
    blackMarketOpportunity += clampNonNegative(Math.max(0, pressureDelta) + Math.max(0, recoveryDelta * 0.35) + (entry.tags.includes("black_market_opening") ? 5 : 0));
    blackMarketHeat += clampNonNegative(Math.max(0, pressureDelta * 0.4) + Math.max(0, threatDelta * 0.5));
    factionDriftScore += clampNonNegative(Math.max(0, threatDelta) + Math.max(0, -controlDelta) + (entry.tags.includes("faction_drift") ? 3 : 0));
    factionInstability += clampNonNegative(Math.max(0, pressureDelta * 0.5) + Math.max(0, recoveryDelta * 0.35) + Math.max(0, threatDelta));
    if (entry.severity === "severe") severeCount += 1;
    if (!lastUpdatedAt || entry.createdAt > lastUpdatedAt) lastUpdatedAt = entry.createdAt;
  }

  const regions = Array.from(regionMap.values()).sort((a, b) => {
    const scoreA = a.tradeDisruption + a.blackMarketHeat + a.factionDrift + Math.max(0, a.netPressure);
    const scoreB = b.tradeDisruption + b.blackMarketHeat + b.factionDrift + Math.max(0, b.netPressure);
    return scoreB - scoreA;
  });

  const destabilizationScore = tradePressure + supplyFriction + cartelAttention + blackMarketOpportunity + factionInstability;
  const blackMarketScore = blackMarketOpportunity + Math.round(blackMarketHeat * 0.5);
  const dominantStance = factionStance(factionDriftScore + Math.round(factionInstability * 0.35));
  const note = entries.length === 0
    ? "No propagated consequence pressure yet."
    : dominantStance === "fracturing"
    ? "City consequence exports are destabilizing multiple fronts and feeding black-market escalation."
    : dominantStance === "destabilizing"
    ? "Propagated city setbacks are destabilizing regional posture and opening black-market routes."
    : blackMarketScore > 0
    ? "Consequence propagation is creating black-market and trade pressure signals."
    : "Propagated world consequence pressure is active.";

  return {
    regions,
    worldEconomy: {
      tradePressure,
      supplyFriction,
      cartelAttention,
      destabilization: destabilizationScore,
      outlook: economyOutlook(tradePressure + supplyFriction + cartelAttention),
    },
    blackMarket: {
      opportunityScore: blackMarketOpportunity,
      heat: blackMarketHeat,
      outlook: blackMarketOutlook(blackMarketScore),
    },
    factionPressure: {
      driftScore: factionDriftScore,
      instability: factionInstability,
      dominantStance,
    },
    summary: {
      affectedRegionIds: regions.map((entry) => entry.regionId),
      totalLedgerEntries: entries.length,
      severeCount,
      destabilizationScore,
      note,
    },
    lastUpdatedAt,
  };
}

export function recomputeWorldConsequenceState(ps: PlayerState): WorldConsequenceState {
  const state = deriveWorldConsequenceState(ps.worldConsequences ?? []);
  ps.worldConsequenceState = state;
  return state;
}

export function pushWorldConsequence(ps: PlayerState, entry: Omit<WorldConsequenceLedgerEntry, "id" | "createdAt" | "playerId" | "cityId">): WorldConsequenceLedgerEntry {
  const record: WorldConsequenceLedgerEntry = {
    id: `wce_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    createdAt: new Date().toISOString(),
    playerId: ps.playerId,
    cityId: ps.city.id,
    ...entry,
  };

  ps.worldConsequences = [record, ...(ps.worldConsequences ?? [])].slice(0, MAX_WORLD_CONSEQUENCE_LEDGER);
  recomputeWorldConsequenceState(ps);
  return record;
}

export function buildSetbackWorldConsequence(input: {
  missionId: string;
  missionTitle: string;
  regionId: string;
  threatFamily?: ThreatFamily;
  outcome: "success" | "partial" | "failure";
  pressureDelta: number;
  recoveryDelta: number;
  controlDelta: number;
  threatDelta: number;
  setbackCount: number;
}): Omit<WorldConsequenceLedgerEntry, "id" | "createdAt" | "playerId" | "cityId"> {
  const severityScore = Math.abs(input.pressureDelta) + Math.abs(input.recoveryDelta) + Math.abs(input.controlDelta) + Math.abs(input.threatDelta) + input.setbackCount;
  const severity = clampSeverity(severityScore);
  const tags: WorldConsequenceTag[] = ["city_pressure_export", "regional_instability"];
  if (input.recoveryDelta > 0) tags.push("recovery_load");
  if (input.threatDelta > 0 || input.controlDelta < 0) tags.push("faction_drift");
  if (input.threatDelta > 0) tags.push("trade_disruption");
  if (input.pressureDelta >= 8 || input.recoveryDelta >= 10) tags.push("black_market_opening", "world_economy_hook");

  const pressureDirection = input.pressureDelta > 0 ? `pressure +${input.pressureDelta}` : input.pressureDelta < 0 ? `pressure ${input.pressureDelta}` : "pressure unchanged";
  const recoveryDirection = input.recoveryDelta > 0 ? `recovery burden +${input.recoveryDelta}` : input.recoveryDelta < 0 ? `recovery burden ${input.recoveryDelta}` : "recovery stable";
  const regionDirection = `region control ${input.controlDelta >= 0 ? "+" : ""}${input.controlDelta}, threat ${input.threatDelta >= 0 ? "+" : ""}${input.threatDelta}`;

  return {
    regionId: input.regionId,
    source: "mission_setback",
    severity,
    title: `Setback exported from ${input.missionTitle}`,
    summary: `${input.setbackCount} setback(s) turned into regional pressure: ${pressureDirection}, ${recoveryDirection}, ${regionDirection}.`,
    detail: `City failure consequences are no longer staying local. ${input.missionTitle} now records a world-facing ledger event for Mother Brain/admin/player inspection.${input.threatFamily ? ` Threat family: ${input.threatFamily}.` : ""}`,
    audiences: ["player", "mother_brain", "admin"],
    tags: unique(tags),
    metrics: {
      pressureDelta: input.pressureDelta,
      recoveryDelta: input.recoveryDelta,
      controlDelta: input.controlDelta,
      threatDelta: input.threatDelta,
    },
    missionId: input.missionId,
    missionTitle: input.missionTitle,
    threatFamily: input.threatFamily,
    outcome: input.outcome,
  };
}

export function buildRecoveryContractWorldConsequence(input: {
  missionId: string;
  missionTitle: string;
  regionId: string;
  contractKind: RecoveryContractKind;
  outcome: "success" | "partial" | "failure";
  pressureDelta: number;
  recoveryDelta: number;
  trustDelta: number;
}): Omit<WorldConsequenceLedgerEntry, "id" | "createdAt" | "playerId" | "cityId"> {
  const severityScore = Math.abs(input.pressureDelta) + Math.abs(input.recoveryDelta) + Math.max(0, -input.trustDelta);
  const severity = clampSeverity(severityScore);
  const tags: WorldConsequenceTag[] = ["city_pressure_export", "recovery_load"];
  if (input.outcome === "success") {
    tags.push("faction_drift");
  } else {
    tags.push("regional_instability", "trade_disruption");
  }
  if (input.outcome === "failure" || input.pressureDelta >= 4) {
    tags.push("black_market_opening", "world_economy_hook");
  }

  const trustDirection = input.trustDelta === 0 ? "trust flat" : input.trustDelta > 0 ? `trust +${input.trustDelta}` : `trust ${input.trustDelta}`;

  return {
    regionId: input.regionId,
    source: "recovery_contract",
    severity,
    title: `Recovery contract exported: ${input.contractKind}`,
    summary: `${input.outcome} contract result exported with pressure ${input.pressureDelta >= 0 ? "+" : ""}${input.pressureDelta}, burden ${input.recoveryDelta >= 0 ? "+" : ""}${input.recoveryDelta}, ${trustDirection}.`,
    detail: `Recovery work now leaves a world-facing paper trail instead of dying inside city receipts. ${input.missionTitle} records the contract outcome for downstream Mother Brain, economy, and admin consumers.`,
    audiences: ["player", "mother_brain", "admin"],
    tags: unique(tags),
    metrics: {
      pressureDelta: input.pressureDelta,
      recoveryDelta: input.recoveryDelta,
      controlDelta: 0,
      threatDelta: input.outcome === "success" ? -Math.max(1, Math.round(Math.abs(input.pressureDelta) * 0.4)) : Math.max(1, Math.round(Math.abs(input.pressureDelta) * 0.4)),
    },
    missionId: input.missionId,
    missionTitle: input.missionTitle,
    contractKind: input.contractKind,
    outcome: input.outcome,
  };
}
