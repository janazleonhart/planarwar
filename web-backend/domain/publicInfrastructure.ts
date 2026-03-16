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

export interface PublicServiceQuote {
  service: PublicServiceKind;
  mode: InfrastructureMode;
  permitTier: CivicPermitTier;
  levy: Partial<Resources>;
  queueMinutes: number;
  strainScore: number;
  note: string;
}

const MAX_RECEIPTS = 12;
const RESOURCE_KEYS: Array<keyof Resources> = ["food", "materials", "wealth", "mana", "knowledge", "unity"];

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
    return infra.noviceSubsidyCreditsUsed < 8 ? 0.5 : 0.8;
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

function getActiveQueuePressure(ps: PlayerState): number {
  const activeWorkshopJobs = (ps.workshopJobs ?? []).filter((job) => !job.completed).length;
  const researchPressure = ps.activeResearch ? 1 : 0;
  const armyPressure = Math.max(0, ps.armies.length - 1);
  return activeWorkshopJobs * 2 + researchPressure * 3 + armyPressure;
}

export function quotePublicServiceUsage(
  ps: PlayerState,
  service: PublicServiceKind,
  baseCosts: Partial<Resources>,
  mode: InfrastructureMode = "private_city"
): PublicServiceQuote {
  const infra = ensurePublicInfrastructureState(ps);
  const permitTier = deriveCivicPermitTier(ps);

  if (mode === "private_city") {
    return {
      service,
      mode,
      permitTier,
      levy: {},
      queueMinutes: 0,
      strainScore: 0,
      note: "Private city infrastructure avoids public levies and queue drag.",
    };
  }

  const base = PUBLIC_SERVICE_BASE[service];
  const strainTotal = Math.max(0, Number(ps.cityStress?.total ?? 0));
  const heat = Math.max(0, Number(infra.serviceHeat ?? 0));
  const queuePressure = getActiveQueuePressure(ps);
  const strainScore = Math.min(100, Math.round(strainTotal * 0.55 + heat * 0.35 + queuePressure * 2.5));
  const permitDiscount = getPermitDiscountMultiplier(permitTier, infra);
  const stageMult = getStageStrainMultiplier(ps.cityStress?.stage ?? "stable");
  const pressureMult = 1 + strainScore / 250;
  const levyRate = base.levyRate * stageMult * pressureMult * permitDiscount;
  const levy = buildLevy(baseCosts, levyRate);
  const queueMinutes = Math.max(1, Math.round(base.queueMinutes * stageMult + queuePressure / 2));

  let note = `NPC public service used: ${base.label}.`;
  if (permitTier === "novice" && infra.noviceSubsidyCreditsUsed < 8) {
    note += " Novice civic subsidy reduced the levy.";
  } else if (permitTier === "trusted") {
    note += " Trusted-citizen terms reduced the levy slightly.";
  }
  if ((ps.cityStress?.stage ?? "stable") !== "stable") {
    note += ` Regional strain is ${ps.cityStress.stage}, increasing public costs.`;
  }

  return {
    service,
    mode,
    permitTier,
    levy,
    queueMinutes,
    strainScore,
    note,
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
    if (quote.permitTier === "novice" && infra.noviceSubsidyCreditsUsed < 8) {
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
