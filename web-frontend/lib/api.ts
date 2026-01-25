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

export interface MissionOffer {
  id: string;
  kind: "hero" | "army";
  difficulty: "low" | "medium" | "high" | "extreme";
  title: string;
  description: string;
  regionId: string;
  recommendedPower: number;
  expectedRewards: RewardBundle;
  risk: MissionRisk;
}

export interface ActiveMission {
  instanceId: string;
  mission: MissionOffer;
  startedAt: string; // ISO string
  finishesAt: string; // ISO string
  assignedHeroId?: string;
  assignedArmyId?: string;
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

export interface Hero {
  id: string;
  ownerId: string;
  name: string;
  role: "champion" | "scout" | "tactician" | "mage";
  power: number;
  tags: string[];
  status: "idle" | "on_mission";
  currentMissionId?: string;

  level?: number;
  xp?: number;
  xpToNext?: number;

  attachments?: { id: string; name: string; kind: string }[];
}

export interface HeroAttachment {
  id: string;
  kind: "valor_charm" | "scouting_cloak" | "arcane_focus";
  name: string;
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

export interface Army {
  id: string;
  cityId: string;
  name: string;
  type: ArmyType;
  power: number;
  size: number;
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
  hunger: number;
  unrest: number;
  corruption: number;
  arcaneHazard: number;
}

export interface MeProfile {
  ok?: boolean;
  userId: string;
  username: string;
  city: CitySummary | null;
  resources: Resources;
  policies: PoliciesState;
  heroes: Hero[];
  armies: Army[];
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

export async function startTech(techId: string): Promise<void> {
  await api("/api/tech/start", {
    method: "POST",
    body: JSON.stringify({ techId }),
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
