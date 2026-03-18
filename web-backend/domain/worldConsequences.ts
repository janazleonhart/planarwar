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

export function pushWorldConsequence(ps: PlayerState, entry: Omit<WorldConsequenceLedgerEntry, "id" | "createdAt" | "playerId" | "cityId">): WorldConsequenceLedgerEntry {
  const record: WorldConsequenceLedgerEntry = {
    id: `wce_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    createdAt: new Date().toISOString(),
    playerId: ps.playerId,
    cityId: ps.city.id,
    ...entry,
  };

  ps.worldConsequences = [record, ...(ps.worldConsequences ?? [])].slice(0, MAX_WORLD_CONSEQUENCE_LEDGER);
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
