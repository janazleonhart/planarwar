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


export function getThreatFamilyDisplayName(family?: string) {
  switch (family) {
    case "bandits":
      return "Bandits";
    case "mercs":
      return "Mercenaries";
    case "desperate_towns":
      return "Desperate towns";
    case "organized_hostile_forces":
      return "Organized hostile forces";
    case "early_planar_strike":
      return "Early planar strike";
    default:
      return "Unclear hostile pressure";
  }
}

export function formatWarningWindow(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const startText = Number.isFinite(start.getTime()) ? start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : startIso;
  const endText = Number.isFinite(end.getTime()) ? end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : endIso;
  return `${startText} → ${endText}`;
}

export function warningQualityTone(quality: string): string {
  switch (quality) {
    case "precise": return "Precise";
    case "clear": return "Clear";
    case "usable": return "Usable";
    default: return "Faint";
  }
}

export function pressureConfidenceLabel(confidence: string): string {
  switch (confidence) {
    case "urgent": return "Urgent";
    case "credible": return "Credible";
    default: return "Watch";
  }
}

export function formatPressureWindow(startIso: string, endIso: string): string {
  return formatWarningWindow(startIso, endIso);
}

export function formatContractKind(kind: string | undefined): string {
  switch (kind) {
    case "stabilize_district": return "Stabilize district";
    case "repair_works": return "Repair works";
    case "relief_convoys": return "Relief convoys";
    case "counter_rumors": return "Counter rumors";
    default: return "";
  }
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

export function cityAlphaSeverityLabel(severity: string): string {
  switch (severity) {
    case "critical": return "Critical";
    case "pressed": return "Pressed";
    case "watch": return "Watch";
    default: return "Calm";
  }
}

export function cityAlphaSeverityColor(severity: string): string {
  switch (severity) {
    case "critical": return "#ff7a7a";
    case "pressed": return "#ffca6b";
    case "watch": return "#9ad0ff";
    default: return "#9ef7b2";
  }
}

export function cityAlphaScopeBucketLabel(bucket: string): string {
  switch (bucket) {
    case "already_exists": return "Already exists";
    case "exists_but_weak": return "Exists but weak";
    case "missing": return "Missing";
    case "excluded": return "Excluded";
    default: return bucket;
  }
}

export function cityAlphaScopeBucketColor(bucket: string): string {
  switch (bucket) {
    case "already_exists": return "#3f8f55";
    case "exists_but_weak": return "#a67c2d";
    case "missing": return "#a64545";
    case "excluded": return "#5d5d88";
    default: return "#555";
  }
}

export function formatResponseLaneList(tags: string[] | undefined): string {
  return tags && tags.length ? tags.join("/") : "general coverage";
}

export function formatWhenShort(iso?: string): string {
  if (!iso) return "now";
  const date = new Date(iso);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : iso;
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
