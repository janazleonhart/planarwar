//web-backend/routes/playerCityAccess.ts

import type { Request } from "express";

import { PostgresAuthService } from "../../worldcore/auth/PostgresAuthService";
import { db } from "../../worldcore/db/Database";
import { DEMO_PLAYER_ID, getDemoPlayer, getOrCreatePlayerState, type PlayerState } from "../gameState";
import blockedNames from "../data/cityBlockedNames.json";

const auth = new PostgresAuthService();
const DEFAULT_CITY_SHARD_ID = "prime_shard";
const DEFAULT_CITY_REGION_ID = "ancient_elwynn";

export interface ViewerIdentity {
  userId: string;
  username: string;
  playerId: string;
  isAuthenticated: boolean;
  isDemo: boolean;
}

export interface CityRow {
  id: string;
  account_id: string;
  shard_id: string;
  name: string;
  meta: Record<string, any> | null;
  created_at?: string;
  updated_at?: string;
}

export interface PlayerAccess {
  viewer: ViewerIdentity;
  playerId: string;
  playerState: PlayerState;
  city: CityRow | null;
}

interface CityRuntimeSnapshotV1 {
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
}

export type PlayerAccessResult =
  | { ok: true; access: PlayerAccess }
  | { ok: false; status: number; error: string; viewer: ViewerIdentity };

function getBearerToken(req: Request): string | null {
  const raw = req.headers.authorization;
  if (!raw || typeof raw !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m?.[1] ?? null;
}

function safeTrim(value: unknown): string {
  return String(value ?? "").trim();
}

export async function resolveViewer(req: Request): Promise<ViewerIdentity> {
  const token = getBearerToken(req);
  if (!token) {
    return { userId: "demo", username: "Demo", playerId: DEMO_PLAYER_ID, isAuthenticated: false, isDemo: true };
  }

  let payload: any = null;
  try {
    payload = await auth.verifyToken(token);
  } catch {
    payload = null;
  }

  if (!payload) {
    return { userId: "demo", username: "Demo", playerId: DEMO_PLAYER_ID, isAuthenticated: false, isDemo: true };
  }

  const userId =
    safeTrim(payload.sub ?? payload.account?.id ?? payload.userId ?? payload.accountId) || "demo";

  const username =
    safeTrim(
      payload.account?.displayName ??
        payload.account?.display_name ??
        payload.displayName ??
        payload.username ??
        payload.email,
    ) || "User";

  if (userId === "demo") {
    return { userId: "demo", username: "Demo", playerId: DEMO_PLAYER_ID, isAuthenticated: false, isDemo: true };
  }

  return { userId, username, playerId: userId, isAuthenticated: true, isDemo: false };
}

export async function getCityByAccountId(accountId: string): Promise<CityRow | null> {
  const result = await db.query(
    `
      SELECT id, account_id, shard_id, name, meta, created_at, updated_at
      FROM public.cities
      WHERE account_id = $1::uuid
      LIMIT 1
    `,
    [accountId],
  );

  if (!result.rowCount) return null;
  return (result.rows[0] as CityRow) ?? null;
}

function normalizeCityMeta(meta: any): Record<string, any> {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  return { ...meta };
}

function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSnapshot(meta: Record<string, any> | null | undefined): CityRuntimeSnapshotV1 | null {
  if (!meta || typeof meta !== "object") return null;
  if (meta.runtimeStateVersion !== 1) return null;
  const state = meta.runtimeState;
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  return state as CityRuntimeSnapshotV1;
}

const MAX_SNAPSHOT_EVENT_LOG = 60;
const MAX_SNAPSHOT_OFFERS = 24;

function buildRuntimeSnapshot(ps: PlayerState): CityRuntimeSnapshotV1 {
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
  };
}

function applyRuntimeSnapshot(ps: PlayerState, snapshot: CityRuntimeSnapshotV1): PlayerState {
  const city = snapshot.city ?? {};
  ps.city = {
    ...ps.city,
    tier: typeof city.tier === "number" ? city.tier : ps.city.tier,
    regionId: typeof city.regionId === "string" && city.regionId.trim() ? (city.regionId as any) : ps.city.regionId,
    maxBuildingSlots: typeof city.maxBuildingSlots === "number" ? city.maxBuildingSlots : ps.city.maxBuildingSlots,
    stats: city.stats ? (deepCloneJson(city.stats) as PlayerState["city"]["stats"]) : ps.city.stats,
    buildings: Array.isArray(city.buildings) ? (deepCloneJson(city.buildings) as PlayerState["city"]["buildings"]) : ps.city.buildings,
    specializationId: city.specializationId ?? null,
    specializationStars: typeof city.specializationStars === "number" ? city.specializationStars : 0,
    specializationStarsHistory: city.specializationStarsHistory ? (deepCloneJson(city.specializationStarsHistory) as PlayerState["city"]["specializationStarsHistory"]) : {},
  };
  ps.heroes = Array.isArray(snapshot.heroes) ? (deepCloneJson(snapshot.heroes) as PlayerState["heroes"]) : ps.heroes;
  ps.armies = Array.isArray(snapshot.armies) ? (deepCloneJson(snapshot.armies) as PlayerState["armies"]) : ps.armies;
  ps.resources = snapshot.resources ? (deepCloneJson(snapshot.resources) as PlayerState["resources"]) : ps.resources;
  ps.stockpile = snapshot.stockpile ? (deepCloneJson(snapshot.stockpile) as PlayerState["stockpile"]) : ps.stockpile;
  ps.resourceTiers = snapshot.resourceTiers ? (deepCloneJson(snapshot.resourceTiers) as PlayerState["resourceTiers"]) : ps.resourceTiers;
  ps.currentOffers = Array.isArray(snapshot.currentOffers) ? (deepCloneJson(snapshot.currentOffers) as PlayerState["currentOffers"]) : ps.currentOffers;
  ps.activeMissions = Array.isArray(snapshot.activeMissions) ? (deepCloneJson(snapshot.activeMissions) as PlayerState["activeMissions"]) : ps.activeMissions;
  ps.policies = snapshot.policies ? (deepCloneJson(snapshot.policies) as PlayerState["policies"]) : ps.policies;
  ps.lastTickAt = typeof snapshot.lastTickAt === "string" && snapshot.lastTickAt ? snapshot.lastTickAt : ps.lastTickAt;
  ps.researchedTechIds = Array.isArray(snapshot.researchedTechIds) ? (deepCloneJson(snapshot.researchedTechIds) as PlayerState["researchedTechIds"]) : ps.researchedTechIds;
  ps.activeResearch = snapshot.activeResearch ? (deepCloneJson(snapshot.activeResearch) as NonNullable<PlayerState["activeResearch"]>) : undefined;
  ps.regionWar = Array.isArray(snapshot.regionWar) ? (deepCloneJson(snapshot.regionWar) as PlayerState["regionWar"]) : ps.regionWar;
  ps.eventLog = Array.isArray(snapshot.eventLog) ? (deepCloneJson(snapshot.eventLog) as PlayerState["eventLog"]) : ps.eventLog;
  ps.workshopJobs = Array.isArray(snapshot.workshopJobs) ? (deepCloneJson(snapshot.workshopJobs) as PlayerState["workshopJobs"]) : ps.workshopJobs;
  ps.cityStress = snapshot.cityStress ? (deepCloneJson(snapshot.cityStress) as PlayerState["cityStress"]) : ps.cityStress;
  ps.storage = snapshot.storage ? (deepCloneJson(snapshot.storage) as PlayerState["storage"]) : ps.storage;
  ps.techAge = typeof snapshot.techAge === "string" && snapshot.techAge ? snapshot.techAge as any : ps.techAge;
  ps.techEpoch = typeof snapshot.techEpoch === "string" && snapshot.techEpoch ? snapshot.techEpoch as any : ps.techEpoch;
  ps.techCategoryAges = snapshot.techCategoryAges ? (deepCloneJson(snapshot.techCategoryAges) as PlayerState["techCategoryAges"]) : ps.techCategoryAges;
  ps.techFlags = Array.isArray(snapshot.techFlags) ? (deepCloneJson(snapshot.techFlags) as PlayerState["techFlags"]) : ps.techFlags;
  return ps;
}

export async function persistPlayerStateForCity(access: PlayerAccess): Promise<void> {
  if (access.viewer.isDemo || !access.city) return;
  const existingMeta = normalizeCityMeta(access.city.meta);
  const nextMeta = {
    ...existingMeta,
    runtimeStateVersion: 1,
    runtimeState: buildRuntimeSnapshot(access.playerState),
  };

  await db.query(
    `
      UPDATE public.cities
      SET meta = $2::jsonb,
          updated_at = NOW()
      WHERE id = $1::uuid
    `,
    [access.city.id, JSON.stringify(nextMeta)],
  );

  access.city.meta = nextMeta;
}

export function syncPlayerStateFromCityRow(ps: PlayerState, row: CityRow, viewer: ViewerIdentity): PlayerState {
  const meta = normalizeCityMeta(row.meta);
  ps.playerId = viewer.playerId;
  ps.city.id = row.id;
  ps.city.ownerId = viewer.userId;
  ps.city.name = row.name;
  ps.city.shardId = String(row.shard_id || DEFAULT_CITY_SHARD_ID);

  const regionId = safeTrim(meta.regionId);
  if (regionId) {
    (ps.city as any).regionId = regionId;
  }

  return ps;
}

export async function resolvePlayerAccess(
  req: Request,
  opts: { requireCity?: boolean; requireAuth?: boolean } = {},
): Promise<PlayerAccessResult> {
  const viewer = await resolveViewer(req);

  if (viewer.isDemo) {
    return {
      ok: true,
      access: {
        viewer,
        playerId: DEMO_PLAYER_ID,
        playerState: getDemoPlayer(),
        city: null,
      },
    };
  }

  if (opts.requireAuth && !viewer.isAuthenticated) {
    return { ok: false, status: 401, error: "auth_required", viewer };
  }

  const city = await getCityByAccountId(viewer.userId);
  if (!city) {
    if (opts.requireCity) {
      return { ok: false, status: 409, error: "no_city", viewer };
    }
    return { ok: false, status: 404, error: "no_city", viewer };
  }

  const ps = getOrCreatePlayerState(viewer.playerId);
  const snapshot = normalizeSnapshot(city.meta);
  if (snapshot) applyRuntimeSnapshot(ps, snapshot);
  syncPlayerStateFromCityRow(ps, city, viewer);
  return {
    ok: true,
    access: {
      viewer,
      playerId: viewer.playerId,
      playerState: ps,
      city,
    },
  };
}


export type PlayerAccessMutationResult<T> =
  | { ok: true; access: PlayerAccess; value: T }
  | { ok: false; status: number; error: string; viewer: ViewerIdentity };

export async function withPlayerAccessMutation<T>(
  req: Request,
  mutate: (access: PlayerAccess) => Promise<T> | T,
  opts: { requireCity?: boolean; requireAuth?: boolean; persistOnSuccess?: boolean } = {},
): Promise<PlayerAccessMutationResult<T>> {
  const accessResult = await resolvePlayerAccess(req, {
    requireCity: opts.requireCity ?? true,
    requireAuth: opts.requireAuth,
  });
  if (accessResult.ok === false) return accessResult;

  const value = await mutate(accessResult.access);
  if (opts.persistOnSuccess !== false) {
    await persistPlayerStateForCity(accessResult.access);
  }

  return { ok: true, access: accessResult.access, value };
}

export function suggestCityName(displayName: string): string {
  const raw = safeTrim(displayName)
    .replace(/[^A-Za-z0-9 '\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const base = raw || "Founder";
  const words = base.split(" ").filter(Boolean);
  const seed = words.slice(0, 2).join(" ");
  const suggestion = `${seed} Hold`.replace(/\s+/g, " ").trim();
  return suggestion.slice(0, 24).trim() || "New Hold";
}

function normalizeCityName(input: string): string {
  return safeTrim(input).replace(/\s+/g, " ");
}

function foldedName(input: string): string {
  return normalizeCityName(input).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function validateCityName(input: string): { ok: true; normalized: string } | { ok: false; error: string } {
  const normalized = normalizeCityName(input);
  if (!normalized) return { ok: false, error: "city_name_required" };
  if (normalized.length < 3) return { ok: false, error: "city_name_too_short" };
  if (normalized.length > 24) return { ok: false, error: "city_name_too_long" };
  if (!/^[A-Za-z0-9][A-Za-z0-9 '\-]*[A-Za-z0-9]$/.test(normalized)) {
    return { ok: false, error: "city_name_invalid_chars" };
  }

  const exactNames = new Set((blockedNames.exactNames ?? []).map((v: string) => normalizeCityName(v).toLowerCase()));
  const folded = foldedName(normalized);
  const fragments = (blockedNames.blockedFragments ?? []).map((v: string) => foldedName(v));

  if (exactNames.has(normalized.toLowerCase())) {
    return { ok: false, error: "city_name_reserved" };
  }
  if (fragments.some((frag) => frag && folded.includes(frag))) {
    return { ok: false, error: "city_name_blocked" };
  }
  return { ok: true, normalized };
}

function pgErrCode(err: any): string | null {
  const code = err?.code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

export async function createCityForViewer(
  viewer: ViewerIdentity,
  args: { name: string; shardId?: string },
): Promise<{ city: CityRow; playerState: PlayerState; created: boolean }> {
  if (!viewer.isAuthenticated || viewer.isDemo) throw new Error("auth_required");

  const existing = await getCityByAccountId(viewer.userId);
  if (existing) {
    const ps = syncPlayerStateFromCityRow(getOrCreatePlayerState(viewer.playerId), existing, viewer);
    return { city: existing, playerState: ps, created: false };
  }

  const validated = validateCityName(args.name);
  if (validated.ok === false) throw new Error(validated.error);

  const shardId = safeTrim(args.shardId) || DEFAULT_CITY_SHARD_ID;
  const meta = {
    regionId: DEFAULT_CITY_REGION_ID,
    createdBy: "city_bootstrap_v1",
  };

  try {
    const result = await db.query(
      `
        INSERT INTO public.cities (account_id, shard_id, name, meta)
        VALUES ($1::uuid, $2, $3, $4::jsonb)
        RETURNING id, account_id, shard_id, name, meta, created_at, updated_at
      `,
      [viewer.userId, shardId, validated.normalized, JSON.stringify(meta)],
    );

    const row = (result.rows[0] as CityRow) ?? null;
    if (!row) throw new Error("city_create_failed");

    const ps = syncPlayerStateFromCityRow(getOrCreatePlayerState(viewer.playerId), row, viewer);
    const access: PlayerAccess = { viewer, playerId: viewer.playerId, playerState: ps, city: row };
    await persistPlayerStateForCity(access);
    return { city: row, playerState: ps, created: true };
  } catch (err: any) {
    const code = pgErrCode(err);
    const msg = String(err?.message ?? "").toLowerCase();
    if (code === "23505") {
      if (msg.includes("cities_one_per_account")) throw new Error("city_exists");
      if (msg.includes("cities_name_unique_ci")) throw new Error("city_name_taken");
      throw new Error("city_conflict");
    }
    throw err;
  }
}

export async function renameCityForViewer(
  viewer: ViewerIdentity,
  nextName: string,
): Promise<{ city: CityRow; playerState: PlayerState }> {
  if (!viewer.isAuthenticated || viewer.isDemo) throw new Error("auth_required");

  const validated = validateCityName(nextName);
  if (validated.ok === false) throw new Error(validated.error);

  try {
    const result = await db.query(
      `
        UPDATE public.cities
        SET name = $2,
            updated_at = NOW()
        WHERE account_id = $1::uuid
        RETURNING id, account_id, shard_id, name, meta, created_at, updated_at
      `,
      [viewer.userId, validated.normalized],
    );

    if (!result.rowCount) throw new Error("no_city");

    const row = (result.rows[0] as CityRow) ?? null;
    if (!row) throw new Error("city_rename_failed");

    const ps = syncPlayerStateFromCityRow(getOrCreatePlayerState(viewer.playerId), row, viewer);
    const access: PlayerAccess = { viewer, playerId: viewer.playerId, playerState: ps, city: row };
    await persistPlayerStateForCity(access);
    return { city: row, playerState: ps };
  } catch (err: any) {
    const code = pgErrCode(err);
    const msg = String(err?.message ?? "").toLowerCase();
    if (code === "23505" && msg.includes("cities_name_unique_ci")) {
      throw new Error("city_name_taken");
    }
    throw err;
  }
}
