// web-frontend/lib/api.ts
//
// Shared API helper for web-frontend.
//
// Dev trap to avoid:
// - Never default to "localhost" (it points at the *browser* machine, not the VM).
// - Prefer SAME-ORIGIN (/api/...) so Vite can proxy to web-backend without CORS.
// - If you *want* direct cross-origin calls, set VITE_API_BASE_URL and ensure CORS on web-backend.
//
// Recommended on the VM (when using Vite proxy):
//   (no env needed)  -> API calls go to /api/... and Vite proxies them.
//
// Optional override:
//   VITE_API_BASE_URL=http://192.168.0.74:4000

export interface CityBuilding {
  id: string;
  kind: "housing" | "farmland" | "mine" | "arcane_spire";
  level: number;
  name: string;
}

export interface CityStats {
  population: number;
  stability: number;
  prosperity: number;
  security: number;
  infrastructure: number;
  arcaneSaturation: number;
  influence: number;
  unity: number;
}

export interface CityProduction {
  foodPerTick: number;
  materialsPerTick: number;
  wealthPerTick: number;
  manaPerTick: number;
  knowledgePerTick: number;
  unityPerTick: number;
}

export interface CitySummary {
  id: string;
  name: string;
  shardId: string;
  regionId: string;
  tier: number;
  maxBuildingSlots: number;
  stats: CityStats;
  buildings: CityBuilding[];
  specializationId: string | null;
  specializationStars: number;
  specializationStarsHistory: Record<string, number>;
  buildingSlotsUsed: number;
  buildingSlotsMax: number;
  production: CityProduction;
}

export interface MissionRisk {
  casualtyRisk: string;
  heroInjuryRisk?: string;
  notes?: string;
}

export interface RewardBundle {
  wealth?: number;
  food?: number;
  materials?: number;
  mana?: number;
  knowledge?: number;
  influence?: number;
}

export interface MissionOfferSupportGuidance {
  state: "stable" | "pressured" | "restricted";
  severity: number;
  headline: string;
  detail: string;
  recommendedAction: string;
}

export type MissionResponseTag = "frontline" | "recon" | "command" | "recovery" | "warding" | "defense";

export interface MissionOffer {
  contractKind?: RecoveryContractKind;
  contractPressureDelta?: number;
  contractTrustDelta?: number;
  contractRecoveryBurdenDelta?: number;
  threatFamily?: ThreatFamily;
  targetingPressure?: number;
  targetingReasons?: string[];
  id: string;
  kind: "hero" | "army";
  difficulty: "low" | "medium" | "high" | "extreme";
  title: string;
  description: string;
  regionId: string;
  recommendedPower: number;
  expectedRewards: RewardBundle;
  risk: MissionRisk;
  responseTags: MissionResponseTag[];
  supportGuidance?: MissionOfferSupportGuidance;
}

export type MissionResponsePosture = "cautious" | "balanced" | "aggressive" | "desperate";

export interface ActiveMission {
  instanceId: string;
  mission: MissionOffer;
  startedAt: string; // ISO string
  finishesAt: string; // ISO string
  responsePosture: MissionResponsePosture;
  committedResources?: Partial<Resources>;
  assignedHeroId?: string;
  assignedArmyId?: string;
}

export type WarningIntelQuality = "faint" | "usable" | "clear" | "precise";
export type ThreatFamily = "bandits" | "mercs" | "desperate_towns" | "organized_hostile_forces" | "early_planar_strike";
export type RecoveryContractKind = "stabilize_district" | "repair_works" | "relief_convoys" | "counter_rumors";

export interface MissionSetback {
  kind: "resource_loss" | "infrastructure_damage" | "unrest" | "hero_injury" | "army_attrition" | "threat_surge";
  severity: number;
  summary: string;
  detail: string;
  resources?: RewardBundle;
  statImpacts?: Record<string, number>;
}

export interface MissionDefenseReceipt {
  id: string;
  missionId: string;
  missionTitle: string;
  createdAt: string;
  outcome: "success" | "partial" | "failure";
  posture: MissionResponsePosture;
  threatFamily?: ThreatFamily;
  summary: string;
  setbacks: MissionSetback[];
}

export interface ThreatWarning {
  threatFamily?: ThreatFamily;
  targetingPressure?: number;
  targetingReasons?: string[];
  id: string;
  missionId?: string;
  targetRegionId: string;
  issuedAt: string;
  earliestImpactAt: string;
  latestImpactAt: string;
  severity: number;
  intelQuality: WarningIntelQuality;
  headline: string;
  detail: string;
  responseTags: MissionResponseTag[];
  recommendedAction: string;
  recommendedHeroId?: string;
  recommendedArmyId?: string;
}

export interface Resources {
  food: number;
  materials: number;
  wealth: number;
  mana: number;
  knowledge: number;
  unity: number;
}

export interface PoliciesState {
  highTaxes: boolean;
  openTrade: boolean;
  conscription: boolean;
  arcaneFreedom: boolean;
}

export type HeroRole = "champion" | "scout" | "tactician" | "mage";
export type HeroStatus = "idle" | "on_mission";
export type HeroResponseRole = "frontline" | "recon" | "command" | "recovery" | "warding";

export interface HeroTrait {
  id: string;
  name: string;
  polarity: "pro" | "con";
  summary: string;
  responseBias?: Partial<Record<HeroResponseRole, number>>;
  powerDelta?: number;
  injuryDelta?: number;
}

export type HeroAttachmentKind = "valor_charm" | "scouting_cloak" | "arcane_focus";
export type HeroAttachmentSlot = "trinket" | "utility" | "focus";
export type HeroGearFamily = "martial" | "recon" | "arcane";

export interface Hero {
  id: string;
  ownerId: string;
  name: string;
  role: "champion" | "scout" | "tactician" | "mage";
  responseRoles: HeroResponseRole[];
  traits: HeroTrait[];
  power: number;
  tags: string[];
  status: "idle" | "on_mission";
  currentMissionId?: string;

  level?: number;
  xp?: number;
  xpToNext?: number;

  attachments?: HeroAttachment[];
}

export interface HeroAttachment {
  id: string;
  kind: HeroAttachmentKind;
  name: string;
  slot: HeroAttachmentSlot;
  family: HeroGearFamily;
  responseTags: HeroResponseRole[];
  summary?: string;
}

export interface WorkshopJob {
  id: string;
  attachmentKind: "valor_charm" | "scouting_cloak" | "arcane_focus";
  startedAt: string;
  finishesAt: string;
  completed: boolean;
}

export type ArmyType = "militia" | "line" | "vanguard";
export type ArmyStatus = "idle" | "on_mission";

export type ArmyResponseRole = "frontline" | "command" | "defense" | "recovery" | "warding" | "recon";

export interface Army {
  id: string;
  cityId: string;
  name: string;
  type: ArmyType;
  power: number;
  size: number;
  readiness: number;
  upkeep: { wealth: number; materials: number };
  specialties: ArmyResponseRole[];
  status: ArmyStatus;
  currentMissionId?: string;
}

export type TechCategory = "infrastructure" | "agriculture" | "military";

export interface TechSummary {
  id: string;
  name: string;
  description: string;
  category: TechCategory;
  cost: number;
}

export interface ActiveResearchView {
  techId: string;
  name: string;
  description: string;
  category: string;
  cost: number;
  progress: number;
}

export interface RegionWarState {
  regionId: string;
  control: number; // 0–100
  threat: number; // 0–100
}

export type GameEventKind =
  | "mission_start"
  | "mission_complete"
  | "tech_start"
  | "tech_complete"
  | "army_raised"
  | "army_reinforced"
  | "building_constructed"
  | "building_upgraded"
  | "hero_geared"
  | "hero_recruited"
  | "workshop_start"
  | "workshop_complete"
  | "city_stress_change"
  | "mission_refresh_region"
  | "city_tier_up"
  | "city_morph"
  | "resource_tier_up";

export interface GameEvent {
  id: string;
  timestamp: string;
  kind: GameEventKind;
  message: string;
  techId?: string;
  missionId?: string;
}

export interface CityStressState {
  stage: "stable" | "strained" | "crisis" | "lockdown";
  total: number;
  foodPressure: number;
  threatPressure: number;
  unityPressure: number;
  recoveryBurden: number;
  lastUpdatedAt: string;
}


export type InfrastructureMode = "private_city" | "npc_public";
export type CivicPermitTier = "novice" | "standard" | "trusted";
export type PublicPressureSourceKey = "civic_instability" | "regional_threat" | "queue_backlog" | "service_heat" | "mission_load";

export interface PublicPressureSource {
  key: PublicPressureSourceKey;
  label: string;
  score: number;
  detail: string;
}

export interface PublicInfrastructureReceipt {
  id: string;
  service: "building_construct" | "building_upgrade" | "hero_recruit" | "tech_research" | "workshop_craft";
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
  cityStressStage: "stable" | "strained" | "crisis" | "lockdown";
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
  service: "building_construct" | "building_upgrade" | "hero_recruit" | "tech_research" | "workshop_craft";
  mode: InfrastructureMode;
  permitTier: CivicPermitTier;
  levy: Partial<Resources>;
  queueMinutes: number;
  strainScore: number;
  note: string;
  pressureSources: PublicPressureSource[];
}

export interface AppliedPublicServiceUsage {
  quote: PublicServiceQuote;
  receipt: PublicInfrastructureReceipt | null;
  summary: PublicInfrastructureSummary;
  queueAppliedMinutes: number;
  eventMessage: string;
}

export interface PublicInfrastructureStatusResponse {
  ok: boolean;
  publicInfrastructure: PublicInfrastructureState | null;
  summary: PublicInfrastructureSummary | null;
  mode: InfrastructureMode;
  quotes: PublicServiceQuote[];
  pressureSources: PublicPressureSource[];
  cityStress: CityStressState | null;
}


export type VendorScenarioAction = "preview" | "apply";
export type VendorScenarioLane = "essentials" | "comfort" | "luxury" | "arcane";
export type VendorScenarioPresetKey = "scarcity_essentials_protection" | "luxury_throttle" | "arcane_caution" | "broad_recovery";
export type VendorScenarioBridgeBand = "open" | "strained" | "restricted";
export type VendorScenarioVendorState = "abundant" | "stable" | "pressured" | "restricted";
export type VendorScenarioRuntimeState = "surplus" | "normal" | "tight" | "scarce";

export interface VendorScenarioReportSampleItem {
  vendorItemId: number;
  itemId: string;
  itemName: string | null;
  lane: VendorScenarioLane | null;
  runtimeState: VendorScenarioRuntimeState | null;
  allowed: boolean;
  applied: boolean;
  warnings: string[];
}

export interface VendorScenarioReportEntry {
  at: string;
  actor: "admin_ui";
  action: VendorScenarioAction;
  vendorId: string;
  selectionLabel: string;
  laneFilters: VendorScenarioLane[];
  presetKey: VendorScenarioPresetKey | null;
  bridgeBand: VendorScenarioBridgeBand;
  vendorState: VendorScenarioVendorState;
  matchedCount: number;
  appliedCount: number;
  softenedCount: number;
  blockedCount: number;
  warningCount: number;
  note: string;
  selectionKind: "vendor_item_ids" | "lane_filters" | "preset" | "unknown";
  topWarnings: string[];
  sampleItems: VendorScenarioReportSampleItem[];
}

export interface VendorScenarioReviewBucket {
  key: string;
  label: string;
  entryCount: number;
  matched: number;
  applied: number;
  softened: number;
  blocked: number;
  warnings: number;
  previews: number;
  applies: number;
  lastAt: string | null;
}

export interface VendorScenarioReportResponse {
  ok: boolean;
  entries: VendorScenarioReportEntry[];
  rollups: {
    matched: number;
    applied: number;
    softened: number;
    blocked: number;
    warnings: number;
    previews: number;
    applies: number;
  };
  review: {
    reviewWindowSize: number;
    totalMatchingEntries: number;
    distinctVendors: number;
    distinctPresets: number;
    windowRollups: {
      matched: number;
      applied: number;
      softened: number;
      blocked: number;
      warnings: number;
      previews: number;
      applies: number;
    };
    byAction: VendorScenarioReviewBucket[];
    byPreset: VendorScenarioReviewBucket[];
    byLane: VendorScenarioReviewBucket[];
    byBridgeBand: VendorScenarioReviewBucket[];
    byVendorState: VendorScenarioReviewBucket[];
  };
  filtersApplied: {
    action: VendorScenarioAction | null;
    presetKey: VendorScenarioPresetKey | null;
    lane: VendorScenarioLane | null;
    laneSet: string | null;
    bridgeBand: VendorScenarioBridgeBand | null;
    vendorId: string | null;
    vendorState: VendorScenarioVendorState | null;
    before: string | null;
    limit: number;
  };
  malformedCount: number;
  nextCursor: string | null;
  error?: string;
}

export interface VendorScenarioReportQuery {
  action?: VendorScenarioAction;
  presetKey?: VendorScenarioPresetKey | "all";
  lane?: VendorScenarioLane | "all";
  laneSet?: string;
  bridgeBand?: VendorScenarioBridgeBand | "all";
  vendorId?: string;
  vendorState?: VendorScenarioVendorState | "all";
  before?: string | null;
  limit?: number;
}

export type VendorScenarioExportFormat = "csv" | "json";

export interface CityMudBridgeHook {
  key: "vendor_supply" | "caravan_risk" | "mission_support" | "recruitment_pressure" | "public_service_drag";
  label: string;
  score: number;
  direction: "up" | "down" | "neutral";
  detail: string;
  mudEffect: string;
}

export interface CityMudBridgeSummary {
  snapshotAt: string;
  bridgeBand: "open" | "strained" | "restricted";
  recommendedPosture: "supportive" | "cautious" | "defensive";
  supportCapacity: number;
  logisticsPressure: number;
  frontierPressure: number;
  stabilityPressure: number;
  exportableResources: Partial<Resources>;
  hooks: CityMudBridgeHook[];
  tags: string[];
  note: string;
}

export type CityMudConsumerState = "abundant" | "stable" | "pressured" | "restricted";

export interface CityMudConsumerEffect {
  key: "vendor_supply" | "mission_board" | "civic_services";
  label: string;
  state: CityMudConsumerState;
  severity: number;
  headline: string;
  detail: string;
  recommendedAction: string;
}

export interface CityMudConsumerSummary {
  vendorSupply: CityMudConsumerEffect;
  missionBoard: CityMudConsumerEffect;
  civicServices: CityMudConsumerEffect;
  advisories: string[];
}

export interface CityMudVendorSupportPolicy {
  state: CityMudConsumerState;
  stockPosture: "expand" | "maintain" | "throttle" | "restrict";
  pricePosture: "discount" | "baseline" | "caution" | "surge_guard";
  cadencePosture: "accelerate" | "normal" | "slow" | "triage";
  recommendedStockMultiplier: number;
  recommendedPriceMinMultiplier: number;
  recommendedPriceMaxMultiplier: number;
  recommendedRestockCadenceMultiplier: number;
  headline: string;
  detail: string;
  recommendedAction: string;
}

export interface CityMudBridgeStatusResponse {
  ok: boolean;
  summary: CityMudBridgeSummary | null;
  consumers?: CityMudConsumerSummary | null;
  vendorPolicy?: CityMudVendorSupportPolicy | null;
}


export interface MissionBoardResponse {
  missions: MissionOffer[];
  activeMissions: ActiveMission[];
  threatWarnings: ThreatWarning[];
  bridgeSummary?: CityMudBridgeSummary;
  bridgeConsumers?: CityMudConsumerSummary;
}

export interface StartMissionResponse {
  ok: boolean;
  activeMission: ActiveMission;
  activeMissions: ActiveMission[];
  threatWarnings: ThreatWarning[];
  missionReceipts: MissionDefenseReceipt[];
  heroes: Hero[];
  armies: Army[];
  bridgeSummary?: CityMudBridgeSummary;
  bridgeConsumers?: CityMudConsumerSummary;
  missionSupport?: MissionOfferSupportGuidance | CityMudConsumerEffect;
}

export interface CompleteMissionResponse {
  ok: boolean;
  result: any;
  activeMissions: ActiveMission[];
  threatWarnings: ThreatWarning[];
  missionReceipts: MissionDefenseReceipt[];
  heroes: Hero[];
  armies: Army[];
  resources: Resources;
  regionWar: RegionWarState[];
}

export interface MeProfile {
  ok?: boolean;
  isDemo?: boolean;
  hasCity?: boolean;
  canCreateCity?: boolean;
  suggestedCityName?: string;
  userId: string;
  username: string;
  city: CitySummary | null;
  resources: Resources;
  policies: PoliciesState;
  heroes: Hero[];
  armies: Army[];
  activeMissions?: ActiveMission[];
  threatWarnings?: ThreatWarning[];
  missionReceipts?: MissionDefenseReceipt[];
  researchedTechIds: string[];
  availableTechs: TechSummary[];
  activeResearch: ActiveResearchView | null;
  regionWar: RegionWarState[];
  events: GameEvent[];
  workshopJobs: WorkshopJob[];
  cityStress: CityStressState;
  specializationId: string | null;
  specializationStars: number;
  specializationStarsHistory: Record<string, number>;
  publicInfrastructure: PublicInfrastructureState | null;
}

function normalizeBase(raw: string): string {
  return raw.replace(/\/+$/, "");
}

export const API_BASE_URL = (() => {
  const env = ((import.meta as any).env ?? {}) as Record<string, any>;
  const raw = String(env.VITE_API_BASE_URL ?? "").trim();

  // Explicit override (requires CORS on web-backend if cross-origin)
  if (raw) return normalizeBase(raw);

  // Default: SAME-ORIGIN.
  // In dev, Vite should proxy /api -> web-backend (no CORS headaches).
  return "";
})();

async function parseJsonOrThrow(res: Response, normalizedPath: string) {
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return res.json();
  }

  const text = await res.text().catch(() => "");
  const head = text.slice(0, 220).replace(/\s+/g, " ").trim();

  throw new Error(
    `Expected JSON from ${normalizedPath} but got ${contentType || "unknown content-type"}.\n` +
      `API_BASE_URL="${API_BASE_URL || "(same-origin)"}" response head="${head}".\n` +
      `If you're on Vite dev server, ensure it proxies /api to web-backend (or set VITE_API_BASE_URL and enable CORS).`
  );
}

export async function fetchMe(): Promise<MeProfile> {
  return api<MeProfile>("/api/me");
}

export async function fetchPublicInfrastructureStatus(serviceMode: InfrastructureMode): Promise<PublicInfrastructureStatusResponse> {
  const query = new URLSearchParams({ serviceMode }).toString();
  return api<PublicInfrastructureStatusResponse>(`/api/public_infrastructure/status?${query}`);
}

export async function fetchCityMudBridgeStatus(): Promise<CityMudBridgeStatusResponse> {
  return api<CityMudBridgeStatusResponse>("/api/city_mud_bridge/status");
}


function buildVendorScenarioReportParams(query: VendorScenarioReportQuery = {}): URLSearchParams {
  const params = new URLSearchParams();
  if (query.action) params.set("action", query.action);
  if (query.presetKey && query.presetKey !== "all") params.set("presetKey", query.presetKey);
  if (query.lane && query.lane !== "all") params.set("lane", query.lane);
  if (query.laneSet) params.set("laneSet", query.laneSet);
  if (query.bridgeBand && query.bridgeBand !== "all") params.set("bridgeBand", query.bridgeBand);
  if (query.vendorId) params.set("vendorId", query.vendorId);
  if (query.vendorState && query.vendorState !== "all") params.set("vendorState", query.vendorState);
  if (query.before) params.set("before", query.before);
  if (query.limit) params.set("limit", String(query.limit));
  return params;
}

export async function fetchVendorScenarioReports(query: VendorScenarioReportQuery = {}): Promise<VendorScenarioReportResponse> {
  const qs = buildVendorScenarioReportParams(query).toString();
  return api<VendorScenarioReportResponse>(`/api/admin/vendor_economy/scenarios${qs ? `?${qs}` : ""}`);
}

export function buildVendorScenarioReportExportUrl(
  query: VendorScenarioReportQuery = {},
  format: VendorScenarioExportFormat = "csv",
): string {
  const params = buildVendorScenarioReportParams(query);
  params.set("format", format);
  const qs = params.toString();
  return `${API_BASE_URL}/api/admin/vendor_economy/scenarios/export${qs ? `?${qs}` : ""}`;
}

export async function fetchMissionBoard(): Promise<MissionBoardResponse> {
  return api<MissionBoardResponse>("/api/missions/offers");
}

export async function startMission(missionId: string, heroId?: string, armyId?: string, responsePosture?: MissionResponsePosture): Promise<StartMissionResponse> {
  return api<StartMissionResponse>("/api/missions/start", {
    method: "POST",
    body: JSON.stringify({ missionId, heroId, armyId, responsePosture }),
  });
}

export async function completeMission(instanceId: string): Promise<CompleteMissionResponse> {
  return api<CompleteMissionResponse>("/api/missions/complete", {
    method: "POST",
    body: JSON.stringify({ instanceId }),
  });
}

export async function startTech(techId: string, serviceMode?: InfrastructureMode): Promise<any> {
  return api("/api/tech/start", {
    method: "POST",
    body: JSON.stringify(serviceMode ? { techId, serviceMode } : { techId }),
  });
}


export type CityTierUpResult = { ok: boolean; result?: any; error?: string };
export type CityMorphResult = { ok: boolean; result?: any; error?: string };
export type CityDebugResult = { ok: boolean; playerId?: string; city?: CitySummary; resources?: Resources; error?: string };

export async function cityTierUp(): Promise<CityTierUpResult> {
  return api<CityTierUpResult>("/api/city/tier-up", { method: "POST" });
}

export async function cityMorph(specializationId: string): Promise<CityMorphResult> {
  return api<CityMorphResult>("/api/city/morph", {
    method: "POST",
    body: JSON.stringify({ specializationId }),
  });
}

export async function fetchCityDebug(): Promise<CityDebugResult> {
  return api<CityDebugResult>("/api/city");
}

export type CityTierConfigEntry = {
  tier: number;
  techRequirements?: string[];
  baseCost?: { wealth: number; materials: number; knowledge: number; unity: number };
};

export type CityMorphOption = {
  id: string;
  label: string;
  category: string;
  resourceFocus: string;
  resourceKey?: string;
  bonusPerStarPct: number;
  description: string;
};

export type CityConfigResult = {
  ok: boolean;
  status?: { source: string; fallback: boolean; warning?: string };
  config?: {
    tiers: CityTierConfigEntry[];
    morph: { enabledFromTier: number; options: CityMorphOption[] };
  };
  error?: string;
};

export async function fetchCityConfig(): Promise<CityConfigResult> {
  return api<CityConfigResult>("/api/city/config");
}


export type CityBootstrapResult = { ok: boolean; created?: boolean; playerId?: string; city?: CitySummary; resources?: Resources; error?: string };
export type CityRenameResult = { ok: boolean; city?: CitySummary; error?: string };

export async function bootstrapCity(name: string, shardId?: string): Promise<CityBootstrapResult> {
  return api<CityBootstrapResult>("/api/city/bootstrap", {
    method: "POST",
    body: JSON.stringify({ name, shardId }),
  });
}

export async function renameCity(name: string): Promise<CityRenameResult> {
  return api<CityRenameResult>("/api/city/rename", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}
// Auth token helper used across MUD / City Builder / Admin tools.
// Stored by the login UI under localStorage key 'pw_auth_v1'.
export function getAuthToken(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem("pw_auth_v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed.token === "string") return parsed.token;
    return null;
  } catch {
    return null;
  }
}


// --- Admin RBAC helpers (System L) ------------------------------------

export type AdminRole = "readonly" | "editor" | "root";

export type AdminCaps = {
  role: AdminRole | null;
  isAdmin: boolean;
  canWrite: boolean;
  canRoot: boolean;
  flags: Record<string, any>;
};

function normalizeAdminRole(v: any): AdminRole | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "readonly" || s === "editor" || s === "root") return s as AdminRole;
  return null;
}

// Canonical modern key:
//   flags.adminRole: "readonly" | "editor" | "root"
// Back-compat fallbacks:
//   flags.isDev -> root, flags.isGM -> editor, flags.isGuide -> readonly
//   flags.admin / flags.isAdmin / flags.role==="admin" -> editor
export function resolveAdminRoleFromFlags(flags: any): AdminRole | null {
  if (!flags || typeof flags !== "object") return null;

  const direct = normalizeAdminRole((flags as any).adminRole);
  if (direct) return direct;

  if ((flags as any).isDev === true) return "root";
  if ((flags as any).isGM === true) return "editor";
  if ((flags as any).isGuide === true) return "readonly";

  if ((flags as any).admin === true || (flags as any).isAdmin === true || (flags as any).role === "admin") {
    return "editor";
  }

  return null;
}

function safeReadFlagsFromLocalStorage(): Record<string, any> {
  try {
    if (typeof window === "undefined") return {};
    const raw = window.localStorage.getItem("pw_auth_v1");
    if (!raw) return {};
    const parsed = JSON.parse(raw);

    // Old format might be a string token only.
    if (typeof parsed === "string") return {};

    const account = (parsed as any)?.account;
    const flags = account?.flags;
    return flags && typeof flags === "object" ? flags : {};
  } catch {
    return {};
  }
}

export function getAdminCaps(): AdminCaps {
  const flags = safeReadFlagsFromLocalStorage();
  const role = resolveAdminRoleFromFlags(flags);
  const isAdmin = role !== null;
  const canWrite = role === "editor" || role === "root";
  const canRoot = role === "root";
  return { role, isAdmin, canWrite, canRoot, flags };
}

export function explainAdminError(code: string): string {
  const c = String(code || "").trim();
  switch (c) {
    case "admin_required":
      return "Admin access required.";
    case "admin_readonly":
      return "Your admin role is readonly (view-only).";
    case "admin_root_required":
      return "This action requires root admin role.";
    case "missing_token":
    case "invalid_token":
      return "Not logged in (missing/invalid token).";
    default:
      return c || "Unknown error.";
  }
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const method = init.method ?? "GET";

  const token = getAuthToken();
  const res = await fetch(`${API_BASE_URL}${normalizedPath}`, {
    method,
    credentials: "include",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    ...init,
  });

  if (!res.ok) {
    const contentType = res.headers.get("content-type") || "";
    let detail = "";
    try {
      if (contentType.includes("application/json")) {
        const body = await res.json();
        detail = (body as any)?.error ? `: ${(body as any).error}` : "";
      } else {
        const text = await res.text();
        detail = text ? `: ${text}` : "";
      }
    } catch {
      // ignore
    }
    throw new Error(`Failed to fetch ${normalizedPath}: ${res.status}${detail}`);
  }

  if (res.status === 204) return undefined as any;

  return (await parseJsonOrThrow(res, normalizedPath)) as T;
}
