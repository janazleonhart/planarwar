//web-frontend/components/city/CityUiHelpers.ts

import type { CSSProperties } from "react";
import type { AppliedPublicServiceUsage, CityBuilding, Resources } from "../../lib/api";

export function getBuildingUpgradeCost(b: CityBuilding) {
  let baseMaterials = 20;
  let baseWealth = 10;

  switch (b.kind) {
    case "housing":
      baseMaterials = 20;
      baseWealth = 10;
      break;
    case "farmland":
      baseMaterials = 25;
      baseWealth = 15;
      break;
    case "mine":
      baseMaterials = 30;
      baseWealth = 20;
      break;
    case "arcane_spire":
      baseMaterials = 40;
      baseWealth = 30;
      break;
    default:
      break;
  }

  const mult = 1 + b.level * 0.5;

  return {
    materials: Math.round(baseMaterials * mult),
    wealth: Math.round(baseWealth * mult),
  };
}

export function getBuildingConstructionCost(kind: CityBuilding["kind"]) {
  switch (kind) {
    case "housing":
      return { materials: 30, wealth: 10 };
    case "farmland":
      return { materials: 20, wealth: 5 };
    case "mine":
      return { materials: 40, wealth: 15 };
    case "arcane_spire":
      return { materials: 50, wealth: 25 };
    default:
      return { materials: 20, wealth: 10 };
  }
}

export function cardStyle(extra: CSSProperties = {}): CSSProperties {
  return {
    border: "1px solid #444",
    borderRadius: 8,
    padding: 16,
    display: "grid",
    gap: 10,
    ...extra,
  };
}

export function formatLevy(levy: Partial<Resources> | undefined): string {
  if (!levy) return "none";
  const parts = Object.entries(levy)
    .filter(([, amount]) => Number(amount ?? 0) > 0)
    .map(([key, amount]) => `${key} ${amount}`);
  return parts.length ? parts.join(", ") : "none";
}

export function formatExportableResources(resources: Partial<Resources> | undefined): string {
  if (!resources) return "none";
  const parts = Object.entries(resources)
    .filter(([, amount]) => Number(amount ?? 0) > 0)
    .map(([key, amount]) => `${key} ${amount}`);
  return parts.length ? parts.join(", ") : "none";
}

export function formatServiceLabel(service: string): string {
  return service
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function summarizeUsage(usage: AppliedPublicServiceUsage | null | undefined): string | null {
  if (!usage) return null;
  if (usage.quote.mode === "private_city") {
    return `Private lane used. ${usage.summary.note}`;
  }
  const levyText = formatLevy(usage.quote.levy);
  return `${formatServiceLabel(usage.quote.service)} via NPC public lane • levy ${levyText} • queue +${usage.queueAppliedMinutes}m`;
}
