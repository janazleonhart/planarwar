//web-frontend/components/city/cityPolishSummaries.ts

import type { CitySummary, MeProfile, Resources } from "../../lib/api";

export type SummaryTone = "calm" | "watch" | "danger";

export function formatProductionDelta(city: CitySummary | null, key: keyof Resources): string {
  if (!city) return "no city production yet";

  const productionMap: Record<keyof Resources, number> = {
    food: city.production.foodPerTick,
    materials: city.production.materialsPerTick,
    wealth: city.production.wealthPerTick,
    mana: city.production.manaPerTick,
    knowledge: city.production.knowledgePerTick,
    unity: city.production.unityPerTick,
  };

  const value = productionMap[key] ?? 0;
  return `${value >= 0 ? "+" : ""}${value}/tick`;
}

export function summarizeTreasury(
  resources: Resources,
  cityStress: MeProfile["cityStress"],
): { headline: string; detail: string } {
  const total = Object.values(resources).reduce((sum, value) => sum + Number(value ?? 0), 0);

  if (cityStress.stage === "lockdown" || cityStress.stage === "crisis") {
    return {
      headline: "Treasury under pressure",
      detail: `Combined stores ${total}. Keep an eye on burn rate before the board starts pretending panic is a strategy.`,
    };
  }

  if (cityStress.stage === "strained") {
    return {
      headline: "Resources are serviceable",
      detail: `Combined stores ${total}. Plenty to act with, but not enough to be lazy about it.`,
    };
  }

  return {
    headline: "Stores look stable",
    detail: `Combined stores ${total}. This is a decent window for tidy growth instead of emergency patchwork.`,
  };
}

export function summarizePublicInfrastructureReceipts<T extends { queueMinutes?: number; strainScore?: number }>(
  receipts: T[],
): { queueAverage: number; highestStrain: number; latest: T | null } {
  const queueTotal = receipts.reduce((sum, receipt) => sum + Number(receipt.queueMinutes ?? 0), 0);
  const highestStrain = receipts.reduce((max, receipt) => Math.max(max, Number(receipt.strainScore ?? 0)), 0);

  return {
    queueAverage: receipts.length ? Math.round((queueTotal / receipts.length) * 10) / 10 : 0,
    highestStrain,
    latest: receipts[0] ?? null,
  };
}

export function getInfrastructureReceiptTone(strainScore: number): SummaryTone {
  if (strainScore >= 8) return "danger";
  if (strainScore >= 5) return "watch";
  return "calm";
}
