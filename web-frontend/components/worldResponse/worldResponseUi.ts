//web-frontend/components/worldResponse/worldResponseUi.ts

import type { Resources, WorldConsequenceRegionState } from "../../lib/api";

const REGION_META: Record<string, { name: string }> = {
  ancient_elwynn: { name: "Ancient Elwynn" },
  heartland_basin: { name: "Heartland Basin" },
  sunfall_coast: { name: "Sunfall Coast" },
  duskwood_border: { name: "Duskwood Border" },
};

export function getRegionDisplayName(regionId: string) {
  const meta = REGION_META[regionId];
  if (meta?.name) return meta.name;
  return regionId
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatWorldActionCost(cost: Partial<Resources> | undefined): string {
  const entries = Object.entries(cost ?? {}).filter(([, value]) => Number(value ?? 0) > 0);
  if (entries.length <= 0) return "no direct city cost";
  return entries.map(([key, value]) => `${key} ${value}`).join(" • ");
}

export function formatWorldActionCooldown(msRemaining: number | undefined): string {
  const totalSeconds = Math.max(0, Math.ceil(Number(msRemaining ?? 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function worldSeverityColor(severity: string): string {
  switch (severity) {
    case "severe": return "#ff7a7a";
    case "pressure": return "#ffca6b";
    default: return "#9ad0ff";
  }
}

export function worldHookTone(state: string): string {
  switch (state) {
    case "surging":
    case "severe":
    case "fracturing":
    case "fracture_risk":
    case "active":
      return "#ff9c9c";
    case "opening":
    case "watch":
    case "strained":
    case "volatile":
    case "destabilizing":
      return "#ffd27a";
    default:
      return "#b7d7ff";
  }
}

export function worldRegionScore(region: WorldConsequenceRegionState): number {
  return (region.tradeDisruption ?? 0) + (region.blackMarketHeat ?? 0) + Math.abs(region.factionDrift ?? 0) + Math.max(0, region.netPressure ?? 0);
}

export function formatWorldDelta(value: number): string {
  if (value > 0) return `+${value}`;
  return `${value}`;
}

export function formatWorldConsequenceSource(source: string): string {
  return source
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
