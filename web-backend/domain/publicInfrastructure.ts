//web-backend/domain/publicInfrastructure.ts

import type { PlayerState, Resources } from "../gameState";

export type PublicServiceKind =
  | "building_construct"
  | "building_upgrade"
  | "hero_recruit"
  | "tech_research"
  | "workshop_craft";

export type InfrastructureMode = "private_city" | "npc_public";
export type CivicPermitTier = "novice" | "standard" | "trusted";
export type PublicPressureSourceKey =
  | "civic_instability"
  | "regional_threat"
  | "queue_backlog"
  | "service_heat"
  | "mission_load";

export interface PublicPressureSource {
  key: PublicPressureSourceKey;
  label: string;
  score: number;
  detail: string;
}

export interface PublicInfrastructureReceipt {
  id: string;
  service: PublicServiceKind;
  mode: InfrastructureMode;
  permitTier: CivicPermitTier;
  levy: Partial<Resources>;
  queueMinutes: number;
  strainScore: number;
  createdAt: string;
  note: string;
}

export interface PublicInfrastructureState {
  serviceHeat: number;
  lastPublicServiceAt: string | null;
  noviceSubsidyCreditsUsed: number;
  receipts: PublicInfrastructureReceipt[];
}

export interface PublicInfrastructureSummary {
  permitTier: CivicPermitTier;
  serviceHeat: number;
  queuePressure: number;
  cityStressStage: PlayerState["cityStress"]["stage"];
  cityStressTotal: number;
  subsidyCreditsRemaining: number;
  strainBand: "light" | "elevated" | "heavy" | "critical";
  recommendedMode: InfrastructureMode;
  pressureScore: number;
  primaryPressure: PublicPressureSource | null;
  pressureSources: PublicPressureSource[];
  note: string;
}

export interface PublicServiceQuote {
  service: PublicServiceKind;
  mode: InfrastructureMode;
  permitTier: CivicPermitTier;
  levy: Partial<Resources>;
  queueMinutes: number;
  strainScore: number;
  note: string;
  pressureSources: PublicPressureSource[];
}

const MAX_RECEIPTS = 12;
const RESOURCE_KEYS: Array<keyof Resources> = ["food", "materials", "wealth", "mana", "knowledge", "unity"];
const NOVICE_SUBSIDY_MAX = 8;

const PUBLIC_SERVICE_BASE: Record<PublicServiceKind, { levyRate: number; queueMinutes: number; label: string }> = {
  building_construct: { levyRate: 0.16, queueMinutes: 12, label: "public works charter" },
  building_upgrade: { levyRate: 0.14, queueMinutes: 9, label: "public works charter" },
  hero_recruit: { levyRate: 0.14, queueMinutes: 10, label: "guild licensing levy" },
  tech_research: { levyRate: 0.12, queueMinutes: 14, label: "academy bench fee" },
  workshop_craft: { levyRate: 0.18, queueMinutes: 8, label: "forge maintenance tax" },
};

export function createInitialPublicInfrastructureState(nowIso = new Date().toISOString()): PublicInfrastructureState {
  return {
    serviceHeat: 0,
    lastPublicServiceAt: nowIso,
    noviceSubsidyCreditsUsed: 0,
    receipts: [],
  };
}

export function ensurePublicInfrastructureState(ps: PlayerState): PublicInfrastructureState {
  if (!ps.publicInfrastructure) {
    ps.publicInfrastructure = createInitialPublicInfrastructureState(ps.lastTickAt || new Date().toISOString());
  }
  if (!Array.isArray(ps.publicInfrastructure.receipts)) {
    ps.publicInfrastructure.receipts = [];
  }
  if (!Number.isFinite(ps.publicInfrastructure.serviceHeat)) {
    ps.publicInfrastructure.serviceHeat = 0;
  }
  if (!Number.isFinite(ps.publicInfrastructure.noviceSubsidyCreditsUsed)) {
    ps.publicInfrastructure.noviceSubsidyCreditsUsed = 0;
  }
  if (typeof ps.publicInfrastructure.lastPublicServiceAt !== "string") {
    ps.publicInfrastructure.lastPublicServiceAt = null;
  }
  return ps.publicInfrastructure;
}

export function deriveCivicPermitTier(ps: PlayerState): CivicPermitTier {
  const researched = ps.researchedTechIds.length;
  const tier = ps.city.tier ?? 1;
  const heroCount = ps.heroes.length;
  const buildingCount = ps.city.buildings.length;

  // Starter players begin with 4 heroes and 4 buildings, so novice coverage needs
  // to include that baseline instead of treating the default account as already established.
  if (tier <= 1 && researched === 0 && heroCount <= 4 && buildingCount <= 4) {
    return "novice";
  }

  if (tier >= 3 || researched >= 4 || heroCount >= 6) {
    return "trusted";
  }

  return "standard";
}

function getStageStrainMultiplier(stage: PlayerState["cityStress"]["stage"]): number {
  switch (stage) {
    case "strained":
      return 1.12;
    case "crisis":
      return 1.22;
    case "lockdown":
      return 1.34;
    case "stable":
    default:
      return 1;
  }
}

function getPermitDiscountMultiplier(permitTier: CivicPermitTier, infra: PublicInfrastructureState): number {
  if (permitTier === "novice") {
    return infra.noviceSubsidyCreditsUsed < NOVICE_SUBSIDY_MAX ? 0.5 : 0.8;
  }
  if (permitTier === "trusted") {
    return 0.92;
  }
  return 1;
}

function buildLevy(baseCosts: Partial<Resources>, levyRate: number): Partial<Resources> {
  const levy: Partial<Resources> = {};
  for (const key of RESOURCE_KEYS) {
    const base = Number(baseCosts[key] ?? 0);
    if (base > 0) {
      levy[key] = Math.max(1, Math.ceil(base * levyRate));
    }
  }
  return levy;
}

export function getActiveQueuePressure(ps: PlayerState): number {
  const activeWorkshopJobs = (ps.workshopJobs ?? []).filter((job) => !job.completed).length;
  const researchPressure = ps.activeResearch ? 1 : 0;
  const armyPressure = Math.max(0, ps.armies.length - 1);
  return activeWorkshopJobs * 2 + researchPressure * 3 + armyPressure;
}

function deriveStrainBand(score: number): PublicInfrastructureSummary["strainBand"] {
  if (score >= 75) return "critical";
  if (score >= 55) return "heavy";
  if (score >= 30) return "elevated";
  return "light";
}

function clampPressure(score: number, max = 100): number {
  return Math.max(0, Math.min(max, Math.round(score)));
}

function topPressureSummary(source: PublicPressureSource | null): string {
  if (!source) return "Pressure inputs are presently calm.";
  return `${source.label} is the main public-service drag right now.`;
}

export function derivePublicPressureSources(ps: PlayerState): PublicPressureSource[] {
  const infra = ensurePublicInfrastructureState(ps);
  const queuePressure = getActiveQueuePressure(ps);
  const cityStressTotal = Math.max(0, Number(ps.cityStress?.total ?? 0));
  const maxThreat = Math.max(0, ...(ps.regionWar ?? []).map((rw) => Number(rw.threat ?? 0)));
  const activeMissionCount = Math.max(0, Number(ps.activeMissions?.length ?? 0));
  const deployedArmyCount = (ps.armies ?? []).filter((army) => army.status === "on_mission").length;
  const deployedHeroCount = (ps.heroes ?? []).filter((hero) => hero.status === "on_mission").length;

  const sources: PublicPressureSource[] = [
    {
      key: "civic_instability",
      label: "Civic instability",
      score: clampPressure(cityStressTotal * 0.4, 35),
      detail: `City stress is ${ps.cityStress?.stage ?? "stable"} at ${cityStressTotal}/100.`,
    },
    {
      key: "regional_threat",
      label: "Regional threat",
      score: clampPressure(maxThreat * 0.28, 28),
      detail: maxThreat > 0 ? `Frontier threat has peaked at ${maxThreat}/100 across watched regions.` : "Regional threat is currently muted.",
    },
    {
      key: "queue_backlog",
      label: "Queue backlog",
      score: clampPressure(queuePressure * 3.5, 22),
      detail: queuePressure > 0 ? `Active workshops, armies, or research are adding ${queuePressure} queue-pressure points.` : "Local service queues are mostly clear.",
    },
    {
      key: "service_heat",
      label: "Service heat",
      score: clampPressure(Number(infra.serviceHeat ?? 0) * 0.25, 20),
      detail: Number(infra.serviceHeat ?? 0) > 0 ? `Recent NPC public usage has pushed service heat to ${infra.serviceHeat}/100.` : "Recent NPC public usage is light.",
    },
    {
      key: "mission_load",
      label: "Mission load",
      score: clampPressure(activeMissionCount * 5 + deployedArmyCount * 3 + deployedHeroCount * 2, 18),
      detail:
        activeMissionCount + deployedArmyCount + deployedHeroCount > 0
          ? `Field commitments: ${activeMissionCount} active missions, ${deployedArmyCount} armies out, ${deployedHeroCount} heroes deployed.`
          : "No major field commitments are currently draining public logistics.",
    },
  ];

  return sources.sort((a, b) => b.score - a.score);
}

export function summarizePublicInfrastructure(ps: PlayerState): PublicInfrastructureSummary {
  const infra = ensurePublicInfrastructureState(ps);
  const permitTier = deriveCivicPermitTier(ps);
  const queuePressure = getActiveQueuePressure(ps);
  const cityStressTotal = Math.max(0, Number(ps.cityStress?.total ?? 0));
  const pressureSources = derivePublicPressureSources(ps);
  const pressureScore = clampPressure(pressureSources.reduce((sum, source) => sum + source.score, 0));
  const strainBand = deriveStrainBand(pressureScore);
  const subsidyCreditsRemaining = Math.max(0, NOVICE_SUBSIDY_MAX - Math.max(0, infra.noviceSubsidyCreditsUsed ?? 0));
  const recommendedMode: InfrastructureMode = strainBand === "critical" || queuePressure >= 6 ? "private_city" : "npc_public";
  const primaryPressure = pressureSources.find((source) => source.score > 0) ?? null;

  let note = "Public service lanes are calm.";
  switch (strainBand) {
    case "elevated":
      note = `${topPressureSummary(primaryPressure)} Expect small levies and a queue bump.`;
      break;
    case "heavy":
      note = `${topPressureSummary(primaryPressure)} Public infrastructure is under visible strain.`;
      break;
    case "critical":
      note = `${topPressureSummary(primaryPressure)} Public infrastructure is buckling under pressure. Use private lanes unless you enjoy paying the bureaucracy troll toll.`;
      break;
    case "light":
    default:
      if (permitTier === "novice" && subsidyCreditsRemaining > 0) {
        note = `Novice civic subsidy still has ${subsidyCreditsRemaining} discounted uses remaining.`;
      } else if (primaryPressure) {
        note = topPressureSummary(primaryPressure);
      }
      break;
  }

  return {
    permitTier,
    serviceHeat: Math.max(0, Number(infra.serviceHeat ?? 0)),
    queuePressure,
    cityStressStage: ps.cityStress?.stage ?? "stable",
    cityStressTotal,
    subsidyCreditsRemaining,
    strainBand,
    recommendedMode,
    pressureScore,
    primaryPressure,
    pressureSources,
    note,
  };
}

export function quotePublicServiceUsage(
  ps: PlayerState,
  service: PublicServiceKind,
  baseCosts: Partial<Resources>,
  mode: InfrastructureMode = "private_city"
): PublicServiceQuote {
  const infra = ensurePublicInfrastructureState(ps);
  const summary = summarizePublicInfrastructure(ps);
  const permitTier = summary.permitTier;

  if (mode === "private_city") {
    return {
      service,
      mode,
      permitTier,
      levy: {},
      queueMinutes: 0,
      strainScore: 0,
      note: "Private city infrastructure avoids public levies and queue drag.",
      pressureSources: summary.pressureSources,
    };
  }

  const base = PUBLIC_SERVICE_BASE[service];
  const strainScore = summary.pressureScore;
  const permitDiscount = getPermitDiscountMultiplier(permitTier, infra);
  const stageMult = getStageStrainMultiplier(ps.cityStress?.stage ?? "stable");
  const pressureMult = 1 + strainScore / 250;
  const levyRate = base.levyRate * stageMult * pressureMult * permitDiscount;
  const levy = buildLevy(baseCosts, levyRate);
  const queueMinutes = Math.max(1, Math.round(base.queueMinutes * stageMult + summary.queuePressure / 2 + strainScore / 20));
  const topPressures = summary.pressureSources.filter((source) => source.score > 0).slice(0, 2);

  let note = `NPC public service used: ${base.label}.`;
  if (permitTier === "novice" && infra.noviceSubsidyCreditsUsed < NOVICE_SUBSIDY_MAX) {
    note += " Novice civic subsidy reduced the levy.";
  } else if (permitTier === "trusted") {
    note += " Trusted-citizen terms reduced the levy slightly.";
  }
  if ((ps.cityStress?.stage ?? "stable") !== "stable") {
    note += ` Civic strain is ${ps.cityStress.stage}, increasing public costs.`;
  }
  if (topPressures.length > 0) {
    note += ` Main pressure inputs: ${topPressures.map((source) => source.label.toLowerCase()).join(" and ")}.`;
  }

  return {
    service,
    mode,
    permitTier,
    levy,
    queueMinutes,
    strainScore,
    note,
    pressureSources: summary.pressureSources,
  };
}

export function canAffordLevy(resources: Resources, levy: Partial<Resources>): boolean {
  return RESOURCE_KEYS.every((key) => Number(resources[key] ?? 0) >= Number(levy[key] ?? 0));
}

export function applyLevyToResources(resources: Resources, levy: Partial<Resources>): void {
  for (const key of RESOURCE_KEYS) {
    const amount = Number(levy[key] ?? 0);
    if (amount > 0) {
      resources[key] -= amount;
    }
  }
}

export function recordPublicServiceReceipt(
  ps: PlayerState,
  quote: PublicServiceQuote,
  now = new Date()
): PublicInfrastructureReceipt {
  const infra = ensurePublicInfrastructureState(ps);
  const receipt: PublicInfrastructureReceipt = {
    id: `pubsvc_${now.getTime()}_${Math.floor(Math.random() * 100000)}`,
    service: quote.service,
    mode: quote.mode,
    permitTier: quote.permitTier,
    levy: { ...quote.levy },
    queueMinutes: quote.queueMinutes,
    strainScore: quote.strainScore,
    createdAt: now.toISOString(),
    note: quote.note,
  };

  infra.receipts.push(receipt);
  if (infra.receipts.length > MAX_RECEIPTS) {
    infra.receipts.splice(0, infra.receipts.length - MAX_RECEIPTS);
  }

  if (quote.mode === "npc_public") {
    const levyWeight = RESOURCE_KEYS.reduce((sum, key) => sum + Number(quote.levy[key] ?? 0), 0);
    infra.serviceHeat = Math.min(100, Math.round(infra.serviceHeat + 4 + quote.queueMinutes / 2 + levyWeight / 18));
    infra.lastPublicServiceAt = receipt.createdAt;
    if (quote.permitTier === "novice" && infra.noviceSubsidyCreditsUsed < NOVICE_SUBSIDY_MAX) {
      infra.noviceSubsidyCreditsUsed += 1;
    }
  }

  return receipt;
}

export function decayPublicInfrastructureHeat(ps: PlayerState, now = new Date()): void {
  const infra = ensurePublicInfrastructureState(ps);
  if (!infra.lastPublicServiceAt) return;

  const lastAt = Date.parse(infra.lastPublicServiceAt);
  if (Number.isNaN(lastAt)) return;

  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - lastAt) / 60000));
  if (elapsedMinutes <= 0) return;

  const decay = Math.floor(elapsedMinutes / 20);
  if (decay > 0) {
    infra.serviceHeat = Math.max(0, infra.serviceHeat - decay);
    infra.lastPublicServiceAt = now.toISOString();
  }
}
