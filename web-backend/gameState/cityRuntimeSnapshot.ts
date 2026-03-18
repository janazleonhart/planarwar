//web-backend/gameState/cityRuntimeSnapshot.ts

import type { PlayerState } from "../gameState";

const CITY_RUNTIME_SNAPSHOT_VERSION = 1;
const MAX_SNAPSHOT_EVENT_LOG = 60;
const MAX_SNAPSHOT_OFFERS = 24;

export interface CityRuntimeSnapshotV1 {
  version: 1;
  savedAt: string;
  city: Record<string, any>;
  heroes: any[];
  armies: any[];
  resources: Record<string, any>;
  stockpile: Record<string, any>;
  resourceTiers: Record<string, any>;
  currentOffers: any[];
  activeMissions: any[];
  threatWarnings: any[];
  missionReceipts: any[];
  policies: Record<string, any>;
  lastTickAt: string;
  researchedTechIds: string[];
  activeResearch?: Record<string, any>;
  regionWar: any[];
  eventLog: any[];
  workshopJobs: any[];
  cityStress: Record<string, any>;
  storage: Record<string, any>;
  techAge: string;
  techEpoch: string;
  techCategoryAges: Record<string, any>;
  techFlags: string[];
  publicInfrastructure: Record<string, any>;
}

export interface CityRuntimeEnvelopeV1 {
  runtimeStateVersion: 1;
  runtimeState: CityRuntimeSnapshotV1;
}

export interface CityRowAuthority {
  id: string;
  account_id: string;
  shard_id: string;
  name: string;
  meta?: Record<string, any> | null;
}

export interface ViewerAuthority {
  userId: string;
  playerId: string;
}

function safeTrim(value: unknown): string {
  return String(value ?? "").trim();
}

function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeCityMeta(meta: any): Record<string, any> {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  return { ...meta };
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeLegacySnapshot(input: Record<string, any>): CityRuntimeSnapshotV1 | null {
  const state = isRecord(input.runtimeState) ? input.runtimeState : input;
  if (!isRecord(state)) return null;

  const version = Number(state.version ?? input.runtimeStateVersion ?? 1);
  if (!Number.isFinite(version) || version !== CITY_RUNTIME_SNAPSHOT_VERSION) return null;

  return {
    version: 1,
    savedAt: typeof state.savedAt === "string" && state.savedAt ? state.savedAt : new Date(0).toISOString(),
    city: isRecord(state.city) ? deepCloneJson(state.city) : {},
    heroes: Array.isArray(state.heroes) ? deepCloneJson(state.heroes) : [],
    armies: Array.isArray(state.armies) ? deepCloneJson(state.armies) : [],
    resources: isRecord(state.resources) ? deepCloneJson(state.resources) : {},
    stockpile: isRecord(state.stockpile) ? deepCloneJson(state.stockpile) : {},
    resourceTiers: isRecord(state.resourceTiers) ? deepCloneJson(state.resourceTiers) : {},
    currentOffers: Array.isArray(state.currentOffers) ? deepCloneJson(state.currentOffers).slice(0, MAX_SNAPSHOT_OFFERS) : [],
    activeMissions: Array.isArray(state.activeMissions) ? deepCloneJson(state.activeMissions) : [],
    threatWarnings: Array.isArray(state.threatWarnings) ? deepCloneJson(state.threatWarnings) : [],
    missionReceipts: Array.isArray(state.missionReceipts) ? deepCloneJson(state.missionReceipts) : [],
    policies: isRecord(state.policies) ? deepCloneJson(state.policies) : {},
    lastTickAt: typeof state.lastTickAt === "string" ? state.lastTickAt : "",
    researchedTechIds: Array.isArray(state.researchedTechIds) ? deepCloneJson(state.researchedTechIds) : [],
    activeResearch: isRecord(state.activeResearch) ? deepCloneJson(state.activeResearch) : undefined,
    regionWar: Array.isArray(state.regionWar) ? deepCloneJson(state.regionWar) : [],
    eventLog: Array.isArray(state.eventLog) ? deepCloneJson(state.eventLog).slice(-MAX_SNAPSHOT_EVENT_LOG) : [],
    workshopJobs: Array.isArray(state.workshopJobs) ? deepCloneJson(state.workshopJobs) : [],
    cityStress: isRecord(state.cityStress) ? deepCloneJson(state.cityStress) : {},
    storage: isRecord(state.storage) ? deepCloneJson(state.storage) : {},
    techAge: typeof state.techAge === "string" ? state.techAge : "",
    techEpoch: typeof state.techEpoch === "string" ? state.techEpoch : "",
    techCategoryAges: isRecord(state.techCategoryAges) ? deepCloneJson(state.techCategoryAges) : {},
    techFlags: Array.isArray(state.techFlags) ? deepCloneJson(state.techFlags) : [],
    publicInfrastructure: isRecord(state.publicInfrastructure) ? deepCloneJson(state.publicInfrastructure) : {},
  };
}

export function readCityRuntimeSnapshot(meta: Record<string, any> | null | undefined): CityRuntimeSnapshotV1 | null {
  const normalizedMeta = normalizeCityMeta(meta);
  if (normalizedMeta.runtimeStateVersion === CITY_RUNTIME_SNAPSHOT_VERSION && isRecord(normalizedMeta.runtimeState)) {
    return normalizeLegacySnapshot(normalizedMeta.runtimeState);
  }
  if (isRecord(normalizedMeta.runtimeState)) {
    return normalizeLegacySnapshot({
      runtimeStateVersion: normalizedMeta.runtimeStateVersion,
      runtimeState: normalizedMeta.runtimeState,
    });
  }
  return null;
}

export function buildCityRuntimeSnapshot(ps: PlayerState): CityRuntimeSnapshotV1 {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    city: deepCloneJson({
      tier: ps.city.tier,
      regionId: ps.city.regionId,
      maxBuildingSlots: ps.city.maxBuildingSlots,
      stats: ps.city.stats,
      buildings: ps.city.buildings,
      specializationId: ps.city.specializationId ?? null,
      specializationStars: ps.city.specializationStars ?? 0,
      specializationStarsHistory: ps.city.specializationStarsHistory ?? {},
    }),
    heroes: deepCloneJson(ps.heroes),
    armies: deepCloneJson(ps.armies),
    resources: deepCloneJson(ps.resources),
    stockpile: deepCloneJson(ps.stockpile),
    resourceTiers: deepCloneJson(ps.resourceTiers),
    currentOffers: deepCloneJson((ps.currentOffers ?? []).slice(0, MAX_SNAPSHOT_OFFERS)),
    activeMissions: deepCloneJson(ps.activeMissions),
    threatWarnings: deepCloneJson(ps.threatWarnings ?? []),
    missionReceipts: deepCloneJson(ps.missionReceipts ?? []),
    policies: deepCloneJson(ps.policies),
    lastTickAt: ps.lastTickAt,
    researchedTechIds: deepCloneJson(ps.researchedTechIds),
    activeResearch: ps.activeResearch ? deepCloneJson(ps.activeResearch) : undefined,
    regionWar: deepCloneJson(ps.regionWar),
    eventLog: deepCloneJson((ps.eventLog ?? []).slice(-MAX_SNAPSHOT_EVENT_LOG)),
    workshopJobs: deepCloneJson(ps.workshopJobs),
    cityStress: deepCloneJson(ps.cityStress),
    storage: deepCloneJson(ps.storage),
    techAge: ps.techAge,
    techEpoch: ps.techEpoch,
    techCategoryAges: deepCloneJson(ps.techCategoryAges),
    techFlags: deepCloneJson(ps.techFlags),
    publicInfrastructure: deepCloneJson(ps.publicInfrastructure),
  };
}

export function applyCityRuntimeSnapshot(ps: PlayerState, snapshot: CityRuntimeSnapshotV1): PlayerState {
  const city = snapshot.city ?? {};
  ps.city = {
    ...ps.city,
    tier: typeof city.tier === "number" ? city.tier : ps.city.tier,
    regionId: typeof city.regionId === "string" && city.regionId.trim() ? (city.regionId as any) : ps.city.regionId,
    maxBuildingSlots: typeof city.maxBuildingSlots === "number" ? city.maxBuildingSlots : ps.city.maxBuildingSlots,
    stats: isRecord(city.stats) ? (deepCloneJson(city.stats) as PlayerState["city"]["stats"]) : ps.city.stats,
    buildings: Array.isArray(city.buildings) ? (deepCloneJson(city.buildings) as PlayerState["city"]["buildings"]) : ps.city.buildings,
    specializationId: city.specializationId ?? null,
    specializationStars: typeof city.specializationStars === "number" ? city.specializationStars : 0,
    specializationStarsHistory: isRecord(city.specializationStarsHistory)
      ? (deepCloneJson(city.specializationStarsHistory) as PlayerState["city"]["specializationStarsHistory"])
      : {},
  };
  ps.heroes = Array.isArray(snapshot.heroes) ? (deepCloneJson(snapshot.heroes) as PlayerState["heroes"]) : ps.heroes;
  ps.armies = Array.isArray(snapshot.armies) ? (deepCloneJson(snapshot.armies) as PlayerState["armies"]) : ps.armies;
  ps.resources = isRecord(snapshot.resources) ? (deepCloneJson(snapshot.resources) as PlayerState["resources"]) : ps.resources;
  ps.stockpile = isRecord(snapshot.stockpile) ? (deepCloneJson(snapshot.stockpile) as PlayerState["stockpile"]) : ps.stockpile;
  ps.resourceTiers = isRecord(snapshot.resourceTiers) ? (deepCloneJson(snapshot.resourceTiers) as PlayerState["resourceTiers"]) : ps.resourceTiers;
  ps.currentOffers = Array.isArray(snapshot.currentOffers) ? (deepCloneJson(snapshot.currentOffers) as PlayerState["currentOffers"]) : ps.currentOffers;
  ps.activeMissions = Array.isArray(snapshot.activeMissions) ? (deepCloneJson(snapshot.activeMissions) as PlayerState["activeMissions"]) : ps.activeMissions;
  ps.threatWarnings = Array.isArray(snapshot.threatWarnings) ? (deepCloneJson(snapshot.threatWarnings) as PlayerState["threatWarnings"]) : ps.threatWarnings;
  ps.missionReceipts = Array.isArray(snapshot.missionReceipts) ? (deepCloneJson(snapshot.missionReceipts) as PlayerState["missionReceipts"]) : ps.missionReceipts;
  ps.policies = isRecord(snapshot.policies) ? (deepCloneJson(snapshot.policies) as PlayerState["policies"]) : ps.policies;
  ps.lastTickAt = typeof snapshot.lastTickAt === "string" && snapshot.lastTickAt ? snapshot.lastTickAt : ps.lastTickAt;
  ps.researchedTechIds = Array.isArray(snapshot.researchedTechIds)
    ? (deepCloneJson(snapshot.researchedTechIds) as PlayerState["researchedTechIds"])
    : ps.researchedTechIds;
  ps.activeResearch = isRecord(snapshot.activeResearch)
    ? (deepCloneJson(snapshot.activeResearch) as NonNullable<PlayerState["activeResearch"]>)
    : undefined;
  ps.regionWar = Array.isArray(snapshot.regionWar) ? (deepCloneJson(snapshot.regionWar) as PlayerState["regionWar"]) : ps.regionWar;
  ps.eventLog = Array.isArray(snapshot.eventLog) ? (deepCloneJson(snapshot.eventLog) as PlayerState["eventLog"]) : ps.eventLog;
  ps.workshopJobs = Array.isArray(snapshot.workshopJobs)
    ? (deepCloneJson(snapshot.workshopJobs) as PlayerState["workshopJobs"])
    : ps.workshopJobs;
  ps.cityStress = isRecord(snapshot.cityStress) ? (deepCloneJson(snapshot.cityStress) as PlayerState["cityStress"]) : ps.cityStress;
  ps.storage = isRecord(snapshot.storage) ? (deepCloneJson(snapshot.storage) as PlayerState["storage"]) : ps.storage;
  ps.techAge = typeof snapshot.techAge === "string" && snapshot.techAge ? (snapshot.techAge as any) : ps.techAge;
  ps.techEpoch = typeof snapshot.techEpoch === "string" && snapshot.techEpoch ? (snapshot.techEpoch as any) : ps.techEpoch;
  ps.techCategoryAges = isRecord(snapshot.techCategoryAges)
    ? (deepCloneJson(snapshot.techCategoryAges) as PlayerState["techCategoryAges"])
    : ps.techCategoryAges;
  ps.techFlags = Array.isArray(snapshot.techFlags) ? (deepCloneJson(snapshot.techFlags) as PlayerState["techFlags"]) : ps.techFlags;
  ps.publicInfrastructure = isRecord(snapshot.publicInfrastructure)
    ? (deepCloneJson(snapshot.publicInfrastructure) as PlayerState["publicInfrastructure"])
    : ps.publicInfrastructure;
  return ps;
}

export function buildCityRuntimeEnvelope(ps: PlayerState, existingMeta?: Record<string, any> | null): CityRuntimeEnvelopeV1 & Record<string, any> {
  return {
    ...normalizeCityMeta(existingMeta),
    runtimeStateVersion: 1,
    runtimeState: buildCityRuntimeSnapshot(ps),
  };
}

export function applyCityRowAuthority(ps: PlayerState, row: CityRowAuthority, viewer: ViewerAuthority): PlayerState {
  ps.playerId = viewer.playerId;
  ps.city.id = row.id;
  ps.city.ownerId = viewer.userId;
  ps.city.name = row.name;
  ps.city.shardId = safeTrim(row.shard_id) || ps.city.shardId;
  return ps;
}

export function hydratePlayerStateFromCityRow(ps: PlayerState, row: CityRowAuthority, viewer: ViewerAuthority): PlayerState {
  const snapshot = readCityRuntimeSnapshot(row.meta);
  if (snapshot) {
    applyCityRuntimeSnapshot(ps, snapshot);
  } else {
    const meta = normalizeCityMeta(row.meta);
    const regionId = safeTrim(meta.regionId);
    if (regionId) {
      (ps.city as any).regionId = regionId;
    }
  }

  return applyCityRowAuthority(ps, row, viewer);
}
