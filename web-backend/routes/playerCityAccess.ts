//web-backend/routes/playerCityAccess.ts

import type { Request } from "express";

import { PostgresAuthService } from "../../worldcore/auth/PostgresAuthService";
import { db } from "../../worldcore/db/Database";
import { DEMO_PLAYER_ID, getDemoPlayer, getOrCreatePlayerState, type PlayerState } from "../gameState";
import blockedNames from "../data/cityBlockedNames.json";
import {
  buildCityRuntimeEnvelope,
  hydratePlayerStateFromCityRow,
} from "../gameState/cityRuntimeSnapshot";

const auth = new PostgresAuthService();
const DEFAULT_CITY_SHARD_ID = "prime_shard";
const DEFAULT_CITY_REGION_ID = "ancient_elwynn";


export type SettlementLaneChoice = "city" | "black_market";

export function normalizeSettlementLaneChoice(input: unknown): SettlementLaneChoice {
  return String(input ?? "").trim().toLowerCase() === "black_market" ? "black_market" : "city";
}

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

export async function persistPlayerStateForCity(access: PlayerAccess): Promise<void> {
  if (access.viewer.isDemo || !access.city) return;
  const nextMeta = buildCityRuntimeEnvelope(access.playerState, access.city.meta);

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
  if (!row.shard_id) {
    row.shard_id = DEFAULT_CITY_SHARD_ID;
  }
  return hydratePlayerStateFromCityRow(ps, row, viewer);
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

  const ps = syncPlayerStateFromCityRow(getOrCreatePlayerState(viewer.playerId), city, viewer);
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
  args: { name: string; shardId?: string; settlementLane?: SettlementLaneChoice | string },
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
  const settlementLane = normalizeSettlementLaneChoice(args.settlementLane);
  const meta = {
    regionId: DEFAULT_CITY_REGION_ID,
    settlementLane,
    createdBy: "city_bootstrap_lane_choice_v1",
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
