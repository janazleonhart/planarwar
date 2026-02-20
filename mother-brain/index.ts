// mother-brain/index.ts
//
// Mother Brain v0.10.1:
// - Fix config typing: include heartbeatEveryTicks in MotherBrainConfig + parseConfig return.
// - DB heartbeat support (Option A) remains best-effort and non-fatal.
// - Optional HTTP status server still supported (disabled unless MOTHER_BRAIN_HTTP_PORT > 0).
//
// DB Heartbeat table expected (migration in worldcore/infra/schema/079_service_heartbeats_v0.sql):
//  service_heartbeats(
//    service_name PK,
//    instance_id, host, pid,
//    version, mode,
//    ready,
//    last_tick, last_signature, last_status_json,
//    started_at, last_tick_at, updated_at
//  )

import dotenv from "dotenv";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import WebSocket from "ws";
import { Pool } from "pg";
import type { QueryResult, QueryResultRow } from "pg";
import { z } from "zod";

// Dirent type lives on node:fs (not node:fs/promises). Keeping this here avoids
// TS errors for any probe code that uses readdir({ withFileTypes:true }).
import type { Dirent } from "node:fs";

import { installFileLogTap } from "./FileLogTap";
import {
  computeGoalsHealth,
  createGoalsState,
  getActiveGoals,
  getGoalSuites,
  runGoalSuites,
  setInMemoryGoals,
  type GoalDefinition,
  type GoalRunReport,
  type GoalsHealth,
  type GoalsState,
} from "./Goals";

export type Logger = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type LogLevel = "debug" | "info" | "warn" | "error";
type MotherBrainMode = "observe" | "apply";

type BrainSpawnSummaryRow = {
  shardId: string | null;
  type: string;
  count: number;
};

type BrainSpawnSummary = {
  total: number;
  topByShardType: BrainSpawnSummaryRow[];
};

type BrainWaveBudgetSnapshot =
  | {
      ok: true;
      total: number;
      topByShardType: BrainSpawnSummaryRow[];
      caps?: { shardId: string; type: string; cap: number; policy: string; updatedAt: string }[];
      remaining?: { shardId: string; type: string; cap: number; used: number; remaining: number; policy: string }[];
      // Optional: if we also compute/report violations, keep TS happy across variants.
      breaches?: { shardId: string; type: string; cap: number; used: number; overBy: number; policy: string }[];
    }
  | {
      ok: false;
      reason: string;
      missingColumns?: string[];
      schema?: SpawnPointsSchemaProbe | null;
    };


type SpawnPointsSchemaProbe = {
  exists: boolean;
  missingColumns: string[];
  columnCount?: number;
};

type ProbeResult = {
  ok: boolean;
  latencyMs?: number;
  error?: string;
};

type WsPingResult = {
  ok: boolean;
  latencyMs?: number;
  lastPongIso?: string;
  error?: string;
};

type TickSnapshot = {
  tick: number;
  uptimeMs: number;
  mode: MotherBrainMode;

  db: {
    enabled: boolean;
    ok?: boolean;
    latencyMs?: number;
    error?: string;
    serverVersion?: string | null;
    dbName?: string | null;
    brainSpawns?: BrainSpawnSummary | null;
    spawnPointsSchema?: SpawnPointsSchemaProbe | null;
    brainWaveBudget?: BrainWaveBudgetSnapshot | null;
  };

  ws: {
    enabled: boolean;
    state: "disabled" | "closed" | "connecting" | "open";
    ok?: boolean;
    latencyMs?: number;
    error?: string;
    pingOk?: boolean;
    pingLatencyMs?: number;
    lastPongIso?: string | null;
    pingError?: string;
  };

  goals?: {
    enabled: boolean;
    everyTicks: number;
    packIds: string[];
    filePath?: string;
    reportDir?: string;
    lastRunIso: string | null;
    lastOk: boolean | null;
    lastSummary: GoalRunReport["summary"] | null;
    lastBySuite?: Record<string, { ok: boolean; summary: GoalRunReport["summary"] }>;
    health: GoalsHealth;
  };
};

function nowIso(): string {
  return new Date().toISOString();
}


function getServiceVersion(): string | null {
  // Prefer npm's injected env var (works in dev via npm scripts).
  const fromNpm = process.env.npm_package_version;
  if (fromNpm && fromNpm.trim().length > 0) return fromNpm.trim();

  // Best-effort: try to read package.json at runtime.
  // In ts-node-dev, cwd is usually mother-brain/; in dist, cwd is repo root.
  const candidates = [
    path.resolve(process.cwd(), "package.json"),
    path.resolve(process.cwd(), "mother-brain", "package.json"),
    path.resolve(__dirname, "..", "package.json"),
  ];

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf-8");
      const pkg = JSON.parse(raw) as { version?: unknown };
      if (typeof pkg.version === "string" && pkg.version.trim().length > 0) return pkg.version.trim();
    } catch {
      // ignore
    }
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  const base = `[mother-brain] ${nowIso()} ${level.toUpperCase()}: ${msg}`;
  if (!extra || Object.keys(extra).length === 0) {
    // eslint-disable-next-line no-console
    console.log(base);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(base, JSON.stringify(extra));
}

function loadDotEnv(): void {
  const candidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      log("debug", "Loaded env file", { path: p });
      return;
    }
  }

  log("debug", "No .env file found (continuing with process.env)");
}

/**
 * Planar War convention: most services use PW_DB_* vars (host/port/user/pass/name).
 * Mother Brain supports either:
 * - MOTHER_BRAIN_DB_URL (direct)
 * - OR PW_DB_* (bridged into PW_DATABASE_URL/DATABASE_URL + PG* vars)
 */
function bridgePwDbEnv(): void {
  if (process.env.MOTHER_BRAIN_DB_URL) return;
  if (process.env.PW_DATABASE_URL || process.env.DATABASE_URL) return;

  const host = process.env.PW_DB_HOST;
  const port = process.env.PW_DB_PORT;
  const user = process.env.PW_DB_USER;
  const pass = process.env.PW_DB_PASS ?? "";
  const name = process.env.PW_DB_NAME;

  if (!host || !port || !user || !name) return;

  const auth =
    pass && pass.length > 0
      ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}`
      : encodeURIComponent(user);

  const url = `postgresql://${auth}@${host}:${port}/${name}`;

  process.env.PW_DATABASE_URL = url;
  process.env.DATABASE_URL = url;

  process.env.PGHOST = host;
  process.env.PGPORT = port;
  process.env.PGUSER = user;
  process.env.PGDATABASE = name;
  if (pass && pass.length > 0) process.env.PGPASSWORD = pass;
}

function parsePgArrayText(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") {
    const s = value.trim();
    if (s.startsWith("{") && s.endsWith("}")) {
      const inner = s.slice(1, -1);
      if (inner.length === 0) return [];
      return inner
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    }
  }
  return [];
}

const ConfigSchema = z
  .object({
    MOTHER_BRAIN_MODE: z.enum(["observe", "apply"]).optional().default("observe"),

    MOTHER_BRAIN_TICK_MS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : 5000))
      .refine((n) => Number.isFinite(n) && n >= 250, {
        message: "MOTHER_BRAIN_TICK_MS must be a number >= 250",
      }),

    MOTHER_BRAIN_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional().default("info"),

    // v0.8: tick log controls
    MOTHER_BRAIN_TICK_LOG_EVERY_TICKS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : 6))
      .refine((n) => Number.isFinite(n) && n >= 1, {
        message: "MOTHER_BRAIN_TICK_LOG_EVERY_TICKS must be a number >= 1",
      }),

    MOTHER_BRAIN_TICK_LOG_ON_CHANGE: z
      .string()
      .optional()
      .transform((v) => (v ? v.toLowerCase() === "true" : true)),

    // v0.9: optional HTTP server
    MOTHER_BRAIN_HTTP_HOST: z.string().optional().default("127.0.0.1"),
    MOTHER_BRAIN_HTTP_PORT: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : 0))
      .refine((n) => Number.isFinite(n) && n >= 0 && n <= 65535, {
        message: "MOTHER_BRAIN_HTTP_PORT must be between 0 and 65535",
      }),

    // v0.10: DB heartbeat cadence
    MOTHER_BRAIN_HEARTBEAT_EVERY_TICKS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : 3))
      .refine((n) => Number.isFinite(n) && n >= 1, {
        message: "MOTHER_BRAIN_HEARTBEAT_EVERY_TICKS must be a number >= 1",
      }),

    MOTHER_BRAIN_DB_URL: z.string().optional(),

    // Accept common Planar War DB env bridge outputs
    PW_DATABASE_URL: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    MOTHER_BRAIN_WS_URL: z.string().optional(),
    // If true, WS must be configured and connected for player smoke (ws.connected will FAIL when disabled).
    MOTHER_BRAIN_WS_REQUIRED: z
      .string()
      .optional()
      .transform((v) => (v ? v.toLowerCase() === "true" || v === "1" : false)),

    // If true, /readyz will require goals health to be OK (when goals are enabled).
    // This prevents the service from reporting ready while playtesting is blind/failed.
    MOTHER_BRAIN_READY_REQUIRES_GOALS_OK: z
      .string()
      .optional()
      .transform((v) => (v ? v.toLowerCase() === "true" || v === "1" : false)),

    MOTHER_BRAIN_DB_TIMEOUT_MS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : 2000))
      .refine((n) => Number.isFinite(n) && n >= 250, {
        message: "MOTHER_BRAIN_DB_TIMEOUT_MS must be a number >= 250",
      }),

    MOTHER_BRAIN_WS_TIMEOUT_MS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : 2500))
      .refine((n) => Number.isFinite(n) && n >= 250, {
        message: "MOTHER_BRAIN_WS_TIMEOUT_MS must be a number >= 250",
      }),

    // Optional: WS ping/pong health measurement
    MOTHER_BRAIN_WS_PING_EVERY_TICKS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : 3))
      .refine((n) => Number.isFinite(n) && n >= 1, {
        message: "MOTHER_BRAIN_WS_PING_EVERY_TICKS must be a number >= 1",
      }),

    MOTHER_BRAIN_WS_PING_TIMEOUT_MS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : 2000))
      .refine((n) => Number.isFinite(n) && n >= 250, {
        message: "MOTHER_BRAIN_WS_PING_TIMEOUT_MS must be a number >= 250",
      }),

    // Optional: brain:* spawn_points summary (read-only)
    MOTHER_BRAIN_SPAWN_SUMMARY_EVERY_TICKS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : 12))
      .refine((n) => Number.isFinite(n) && n >= 1, {
        message: "MOTHER_BRAIN_SPAWN_SUMMARY_EVERY_TICKS must be a number >= 1",
      }),

    MOTHER_BRAIN_SPAWN_SUMMARY_TOP_N: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : 8))
      .refine((n) => Number.isFinite(n) && n >= 1 && n <= 100, {
        message: "MOTHER_BRAIN_SPAWN_SUMMARY_TOP_N must be between 1 and 100",
      }),

    // Wave budget probing (read-only; future: used to drive Mother Brain wave/write decisions)
    MOTHER_BRAIN_WAVE_BUDGET_EVERY_TICKS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : 12))
      .refine((n) => Number.isFinite(n) && n >= 1, {
        message: "MOTHER_BRAIN_WAVE_BUDGET_EVERY_TICKS must be a number >= 1",
      }),

    MOTHER_BRAIN_WAVE_BUDGET_TOP_N: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : 8))
      .refine((n) => Number.isFinite(n) && n >= 1 && n <= 50, {
        message: "MOTHER_BRAIN_WAVE_BUDGET_TOP_N must be between 1 and 50",
      }),

    // schema drift probe for spawn_points (read-only)
    MOTHER_BRAIN_SCHEMA_PROBE_EVERY_TICKS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : 30))
      .refine((n) => Number.isFinite(n) && n >= 1, {
        message: "MOTHER_BRAIN_SCHEMA_PROBE_EVERY_TICKS must be a number >= 1",
      }),

    // -----------------------------------------------------------------------
    // Goals runner (observe-only; produces structured JSONL reports)
    // -----------------------------------------------------------------------

    // How often to run goal checks. 0 disables.
    MOTHER_BRAIN_GOALS_EVERY_TICKS: z
      .string()
      .optional()
      // Default ON: Mother Brain is expected to continuously run player-facing smoke goals.
      // Set explicitly to 0 to disable.
      .transform((v) => (v ? Number(v) : 12))
      .refine((n) => Number.isFinite(n) && n >= 0, {
        message: "MOTHER_BRAIN_GOALS_EVERY_TICKS must be a number >= 0",
      }),

    // Optional JSON file containing an array of GoalDefinition (hot-reloaded).
    MOTHER_BRAIN_GOALS_FILE: z.string().optional(),

    // Optional comma-separated list of builtin goal packs (suites).
    // Ignored if GOALS_FILE exists with a non-empty array.
    MOTHER_BRAIN_GOALS_PACKS: z.string().optional(),

    // Optional: if set, Mother Brain will exit non-zero when goals fail.
    // - "0" disables (default)
    // - "1" enables
    MOTHER_BRAIN_GOALS_FAILFAST: z
      .string()
      .optional()
      .transform((v) => (v ? String(v).trim() : "0"))
      .refine((v) => v === "0" || v === "1", {
        message: "MOTHER_BRAIN_GOALS_FAILFAST must be 0 or 1",
      }),

    // Optional report directory. If unset, we will derive from PW_FILELOG.
    MOTHER_BRAIN_GOALS_REPORT_DIR: z.string().optional(),

    // Optional base URL for web-backend admin smoke goals.
    MOTHER_BRAIN_WEB_BACKEND_HTTP_BASE: z.string().optional(),

    // Optional base URL for mmo-backend admin smoke goals (character lifecycle, etc.).
    MOTHER_BRAIN_MMO_BACKEND_HTTP_BASE: z.string().optional(),

    // Optional admin token for calling protected /api/admin endpoints from goal packs.
    // If unset, admin_smoke will be disabled.
    MOTHER_BRAIN_WEB_BACKEND_ADMIN_TOKEN: z.string().optional(),

    // Optional service token for calling protected /api/admin endpoints from goal packs.
    // This is intended for daemon/prod usage (non-human auth). If unset, Mother Brain
    // may still use a human admin token (above) or disable admin_smoke.
    MOTHER_BRAIN_WEB_BACKEND_SERVICE_TOKEN: z.string().optional(),

    // Optional role-scoped service tokens. If set, these take precedence over the generic
    // MOTHER_BRAIN_WEB_BACKEND_SERVICE_TOKEN for the corresponding role.
    MOTHER_BRAIN_WEB_BACKEND_SERVICE_TOKEN_READONLY: z.string().optional(),
    MOTHER_BRAIN_WEB_BACKEND_SERVICE_TOKEN_EDITOR: z.string().optional(),

    // Optional service token for calling protected mmo-backend admin endpoints.
    // If unset, Mother Brain falls back to PW_MOTHER_BRAIN_SERVICE_TOKEN / PW_SERVICE_TOKEN.
    MOTHER_BRAIN_MMO_BACKEND_SERVICE_TOKEN: z.string().optional(),

    // Optional role-scoped service tokens for mmo-backend.
    MOTHER_BRAIN_MMO_BACKEND_SERVICE_TOKEN_READONLY: z.string().optional(),
    MOTHER_BRAIN_MMO_BACKEND_SERVICE_TOKEN_EDITOR: z.string().optional(),
  })
  .passthrough();

type MotherBrainConfig = {
  mode: MotherBrainMode;
  tickMs: number;
  logLevel: LogLevel;

  tickLogEveryTicks: number;
  tickLogOnChange: boolean;

  httpHost: string;
  httpPort: number;

  heartbeatEveryTicks: number;

  dbUrl?: string;
  wsUrl?: string;
  wsRequired: boolean;
  readyRequiresGoalsOk: boolean;

  dbTimeoutMs: number;
  wsTimeoutMs: number;

  wsPingEveryTicks: number;
  wsPingTimeoutMs: number;

  spawnSummaryEveryTicks: number;
  spawnSummaryTopN: number;

  schemaProbeEveryTicks: number;
  brainWaveBudgetEveryTicks: number;
  brainWaveBudgetTopN: number;

  goalsEveryTicks: number;
  goalsFile?: string;
  goalsPacks?: string;
  goalsReportDir?: string;
  goalsFailfast: boolean;
  webBackendHttpBase?: string;
  webBackendAdminToken?: string;
  webBackendServiceToken?: string;
  webBackendServiceTokenReadonly?: string;
  webBackendServiceTokenEditor?: string;

  mmoBackendHttpBase?: string;
  mmoBackendServiceToken?: string;
  mmoBackendServiceTokenReadonly?: string;
  mmoBackendServiceTokenEditor?: string;
};

function parseConfig(): MotherBrainConfig {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), msg: i.message }));
    log("error", "Invalid environment configuration", { issues });
    process.exitCode = 1;
    throw new Error("Invalid environment configuration");
  }

  const env = parsed.data;
  return {
    mode: env.MOTHER_BRAIN_MODE,
    tickMs: env.MOTHER_BRAIN_TICK_MS,
    logLevel: env.MOTHER_BRAIN_LOG_LEVEL,

    tickLogEveryTicks: env.MOTHER_BRAIN_TICK_LOG_EVERY_TICKS,
    tickLogOnChange: env.MOTHER_BRAIN_TICK_LOG_ON_CHANGE,

    httpHost: env.MOTHER_BRAIN_HTTP_HOST,
    httpPort: env.MOTHER_BRAIN_HTTP_PORT,

    heartbeatEveryTicks: env.MOTHER_BRAIN_HEARTBEAT_EVERY_TICKS,

    dbUrl: env.MOTHER_BRAIN_DB_URL ?? env.PW_DATABASE_URL ?? env.DATABASE_URL,
    wsUrl: env.MOTHER_BRAIN_WS_URL,
    wsRequired: env.MOTHER_BRAIN_WS_REQUIRED,
    readyRequiresGoalsOk: env.MOTHER_BRAIN_READY_REQUIRES_GOALS_OK,

    dbTimeoutMs: env.MOTHER_BRAIN_DB_TIMEOUT_MS,
    wsTimeoutMs: env.MOTHER_BRAIN_WS_TIMEOUT_MS,

    wsPingEveryTicks: env.MOTHER_BRAIN_WS_PING_EVERY_TICKS,
    wsPingTimeoutMs: env.MOTHER_BRAIN_WS_PING_TIMEOUT_MS,

    spawnSummaryEveryTicks: env.MOTHER_BRAIN_SPAWN_SUMMARY_EVERY_TICKS,
    spawnSummaryTopN: env.MOTHER_BRAIN_SPAWN_SUMMARY_TOP_N,

    schemaProbeEveryTicks: env.MOTHER_BRAIN_SCHEMA_PROBE_EVERY_TICKS,

    brainWaveBudgetEveryTicks: env.MOTHER_BRAIN_WAVE_BUDGET_EVERY_TICKS,
    brainWaveBudgetTopN: env.MOTHER_BRAIN_WAVE_BUDGET_TOP_N,

    goalsEveryTicks: env.MOTHER_BRAIN_GOALS_EVERY_TICKS,
    goalsFile: env.MOTHER_BRAIN_GOALS_FILE,
    goalsPacks: env.MOTHER_BRAIN_GOALS_PACKS ?? "player_smoke",
    goalsReportDir: env.MOTHER_BRAIN_GOALS_REPORT_DIR,
    goalsFailfast: env.MOTHER_BRAIN_GOALS_FAILFAST === "1",
    webBackendHttpBase: env.MOTHER_BRAIN_WEB_BACKEND_HTTP_BASE,
    mmoBackendHttpBase: env.MOTHER_BRAIN_MMO_BACKEND_HTTP_BASE,
    // IMPORTANT: env is Zod-parsed and only contains keys declared in ConfigSchema.
    // Use process.env for cross-service fallbacks so TS stays strict (no `unknown`).
    webBackendAdminToken: env.MOTHER_BRAIN_WEB_BACKEND_ADMIN_TOKEN ?? process.env.PW_ADMIN_TOKEN,
    webBackendServiceToken:
      env.MOTHER_BRAIN_WEB_BACKEND_SERVICE_TOKEN ?? process.env.PW_MOTHER_BRAIN_SERVICE_TOKEN ?? process.env.PW_SERVICE_TOKEN,

    webBackendServiceTokenReadonly:
      env.MOTHER_BRAIN_WEB_BACKEND_SERVICE_TOKEN_READONLY ??
      env.MOTHER_BRAIN_WEB_BACKEND_SERVICE_TOKEN ??
      process.env.PW_MOTHER_BRAIN_SERVICE_TOKEN ??
      process.env.PW_SERVICE_TOKEN,

    webBackendServiceTokenEditor:
      env.MOTHER_BRAIN_WEB_BACKEND_SERVICE_TOKEN_EDITOR ??
      env.MOTHER_BRAIN_WEB_BACKEND_SERVICE_TOKEN ??
      process.env.PW_MOTHER_BRAIN_SERVICE_TOKEN ??
      process.env.PW_SERVICE_TOKEN,

    mmoBackendServiceToken:
      env.MOTHER_BRAIN_MMO_BACKEND_SERVICE_TOKEN ?? process.env.PW_MOTHER_BRAIN_SERVICE_TOKEN ?? process.env.PW_SERVICE_TOKEN,

    mmoBackendServiceTokenReadonly:
      env.MOTHER_BRAIN_MMO_BACKEND_SERVICE_TOKEN_READONLY ??
      env.MOTHER_BRAIN_MMO_BACKEND_SERVICE_TOKEN ??
      process.env.PW_MOTHER_BRAIN_SERVICE_TOKEN ??
      process.env.PW_SERVICE_TOKEN,

    mmoBackendServiceTokenEditor:
      env.MOTHER_BRAIN_MMO_BACKEND_SERVICE_TOKEN_EDITOR ??
      env.MOTHER_BRAIN_MMO_BACKEND_SERVICE_TOKEN ??
      process.env.PW_MOTHER_BRAIN_SERVICE_TOKEN ??
      process.env.PW_SERVICE_TOKEN,
  };
}

function shouldLog(level: LogLevel, configured: LogLevel): boolean {
  const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  return order[level] >= order[configured];
}

class DbProbe {
  private pool: Pool | null;
  private readonly timeoutMs: number;

  public constructor(dbUrl: string | undefined, timeoutMs: number) {
    this.timeoutMs = timeoutMs;
    this.pool = dbUrl
      ? new Pool({
          connectionString: dbUrl,
          max: 2,
        })
      : null;
  }

  public isEnabled(): boolean {
    return Boolean(this.pool);
  }

  public async query<T extends QueryResultRow = any>(
    sql: string,
    params?: any[]
  ): Promise<QueryResult<T> | null> {
    if (!this.pool) return null;
    return this.withTimeout(this.pool.query(sql, params), this.timeoutMs);
  }

  public async ping(): Promise<ProbeResult> {
    if (!this.pool) return { ok: false, error: "disabled" };

    const start = Date.now();
    try {
      const res = await this.withTimeout(this.pool.query("SELECT 1 as ok"), this.timeoutMs);
      const latencyMs = Date.now() - start;
      const ok = Boolean(res?.rows?.[0]?.ok === 1 || res?.rows?.[0]?.ok === true);
      return { ok, latencyMs };
    } catch (err: unknown) {
      return { ok: false, latencyMs: Date.now() - start, error: this.errToString(err) };
    }
  }

  public async getServerVersion(): Promise<string | null> {
    if (!this.pool) return null;
    try {
      const res = await this.withTimeout(this.pool.query("SHOW server_version"), this.timeoutMs);
      const v = res?.rows?.[0]?.server_version;
      return typeof v === "string" ? v : null;
    } catch {
      return null;
    }
  }

  public async getCurrentDatabase(): Promise<string | null> {
    if (!this.pool) return null;
    try {
      const res = await this.withTimeout(this.pool.query("SELECT current_database() as db"), this.timeoutMs);
      const v = res?.rows?.[0]?.db;
      return typeof v === "string" ? v : null;
    } catch {
      return null;
    }
  }

  public async getBrainSpawnSummary(topN: number): Promise<BrainSpawnSummary | null> {
    if (!this.pool) return null;

    try {
      const totalRes = await this.withTimeout(
        this.pool.query("SELECT COUNT(*)::int as c FROM spawn_points WHERE spawn_id LIKE 'brain:%'"),
        this.timeoutMs
      );
      const total = Number(totalRes?.rows?.[0]?.c ?? 0);

      const rowsRes = await this.withTimeout(
        this.pool.query(
          "SELECT shard_id, type, COUNT(*)::int as c FROM spawn_points WHERE spawn_id LIKE 'brain:%' GROUP BY shard_id, type ORDER BY c DESC LIMIT $1",
          [topN]
        ),
        this.timeoutMs
      );

      const topByShardType: BrainSpawnSummaryRow[] = (rowsRes?.rows ?? []).map((r: any) => ({
        shardId: typeof r.shard_id === "string" ? r.shard_id : null,
        type: String(r.type ?? ""),
        count: Number(r.c ?? 0),
      }));

      return { total, topByShardType };
    } catch {
      return null;
    }
  }

  public async getWaveBudgetCaps(used: BrainSpawnSummaryRow[]): Promise<
    | {
        caps: { shardId: string; type: string; cap: number; policy: string; updatedAt: string }[];
        remaining: { shardId: string; type: string; cap: number; used: number; remaining: number; policy: string }[];
        breaches: { shardId: string; type: string; cap: number; used: number; overBy: number; policy: string }[];
      }
    | null
  > {
    const pool = this.pool;
    if (!pool) return null;

    try {
      const res = await this.withTimeout(
        pool.query<{
          shard_id: string;
          type: string;
          cap: string | number;
          policy: string;
          updated_at: string;
        }>(
          `
          SELECT shard_id, type, cap, policy, updated_at
          FROM spawn_wave_budgets
          ORDER BY shard_id, type
          `
        ),
        this.timeoutMs,
      );

      const caps = res.rows.map((r) => ({
        shardId: r.shard_id,
        type: r.type,
        cap: Number(r.cap),
        policy: r.policy ?? "hard",
        updatedAt: r.updated_at,
      }));

      const usedMap = new Map<string, number>();
      for (const u of used) usedMap.set(`${u.shardId}:${u.type}`, u.count);

      const remaining = caps.map((c) => {
        const u = usedMap.get(`${c.shardId}:${c.type}`) ?? 0;
        return {
          shardId: c.shardId,
          type: c.type,
          cap: c.cap,
          used: u,
          remaining: Math.max(0, c.cap - u),
          policy: c.policy,
        };
      });

      const breaches = remaining
        .map((r) => {
          const overBy = r.used - r.cap;
          return overBy > 0
            ? {
                shardId: r.shardId,
                type: r.type,
                cap: r.cap,
                used: r.used,
                overBy,
                policy: r.policy,
              }
            : null;
        })
        .filter((x): x is { shardId: string; type: string; cap: number; used: number; overBy: number; policy: string } =>
          Boolean(x)
        );

      return { caps, remaining, breaches };
    } catch (err: any) {
      // Missing table is acceptable (feature not enabled yet).
      if (err?.code == "42P01") return null;
      log("error", "[waveBudgetCaps] query failed", { err: this.errToString(err) });
      return null;
    }
  }

  public async probeSpawnPointsSchema(): Promise<SpawnPointsSchemaProbe | null> {
    if (!this.pool) return null;

    const required = ["spawn_id", "shard_id", "type"] as const;

    const sql = `
      SELECT
        EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'spawn_points'
        ) AS exists,
        ARRAY(
          SELECT c.column_name
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = 'spawn_points'
        ) AS columns
    `;

    try {
      const res = await this.withTimeout(this.pool.query(sql), this.timeoutMs);
      const row = (res.rows?.[0] ?? {}) as { exists?: boolean; columns?: unknown };

      const exists = Boolean(row.exists);
      const cols = parsePgArrayText(row.columns);
      const missingColumns = exists ? required.filter((c) => !cols.includes(c)) : [...required];

      return { exists, missingColumns: [...missingColumns], columnCount: cols.length };
    } catch {
      return { exists: false, missingColumns: [...required], columnCount: 0 };
    }
  }

  public async writeHeartbeat(
    serviceName: string,
    instanceId: string,
    host: string,
    pid: number,
    version: string | null,
    mode: string | null,
    ready: boolean,
    lastTick: number,
    signature: string,
    snapshot: TickSnapshot
  ): Promise<void> {
    if (!this.pool) return;

    // Best-effort: if table doesn't exist, or permissions are lacking, we do not throw.
    // Matches schema/079_service_heartbeats_v0.sql
    const sql = `
      INSERT INTO public.service_heartbeats (
        service_name,
        instance_id,
        host,
        pid,
        version,
        mode,
        ready,
        last_tick,
        last_signature,
        last_status_json,
        started_at,
        last_tick_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW(),NOW(),NOW())
      ON CONFLICT (service_name)
      DO UPDATE SET
        instance_id = EXCLUDED.instance_id,
        host = EXCLUDED.host,
        pid = EXCLUDED.pid,
        version = EXCLUDED.version,
        mode = EXCLUDED.mode,
        ready = EXCLUDED.ready,
        last_tick = EXCLUDED.last_tick,
        last_signature = EXCLUDED.last_signature,
        last_status_json = EXCLUDED.last_status_json,
        last_tick_at = NOW(),
        updated_at = NOW()
    `;

    try {
      await this.withTimeout(
        this.pool.query(sql, [
          serviceName,
          instanceId,
          host,
          pid,
          version,
          mode,
          ready,
          lastTick,
          signature,
          JSON.stringify(snapshot),
        ]),
        this.timeoutMs
      );
    } catch {
      // swallow
    }
  }


  public async close(): Promise<void> {
    if (!this.pool) return;
    const p = this.pool;
    this.pool = null;
    await p.end();
  }

  private errToString(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }

  private async withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let t: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        p,
        new Promise<T>((_resolve, reject) => {
          t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
        }),
      ]);
    } finally {
      if (t) clearTimeout(t);
    }
  }
}

type BrainWaveBudgetRow = { shard_id: string; type: string; count: number };
type BrainWaveBudgetReport = {
  byShard: Array<{ shardId: string; total: number; topByType: Array<{ type: string; count: number }> }>;
};

async function probeBrainWaveBudget(
  db: DbProbe,
  cfg: MotherBrainConfig,
): Promise<BrainWaveBudgetSnapshot | null> {
  // Only meaningful when we can talk to Postgres.
  if (!cfg.dbUrl) {
    return { ok: false, reason: "db disabled (no PW_DB_* / PW_DB_URL configured)" };
  }

  // First: do a schema probe so we can explain *why* this might be unavailable.
  const schema = await db.probeSpawnPointsSchema();
  if (!schema) {
    return { ok: false, reason: "spawn_points schema probe failed (see logs)" };
  }
  if (!schema.exists) {
    return { ok: false, reason: "spawn_points table missing", schema };
  }
  if (schema.missingColumns.length > 0) {
    return {
      ok: false,
      reason: "spawn_points schema missing required columns",
      missingColumns: schema.missingColumns,
      schema,
    };
  }

  // Second: compute the summary we use for wave budgeting.
  const summary = await db.getBrainSpawnSummary(cfg.brainWaveBudgetTopN);
  if (!summary) {
    return { ok: false, reason: "spawn_points query failed (see logs)", schema };
  }

  const caps = await db.getWaveBudgetCaps(summary.topByShardType);

  return {
    ok: true,
    total: summary.total,
    topByShardType: summary.topByShardType,
    caps: caps?.caps,
    remaining: caps?.remaining,
    breaches: caps?.breaches,
  };
}


class WsProbe {
  private ws: WebSocket | null = null;
  private readonly url: string | undefined;
  private readonly connectTimeoutMs: number;
  private lastPongIso: string | null = null;

  // v0.21: single-flight MUD command support (one in-flight command at a time).
  // We keep this intentionally simple and protocol-tolerant.
  private mudPending:
    | {
        startedAt: number;
        resolve: (r: { ok: boolean; output?: string; error?: string; latencyMs?: number }) => void;
        timer: NodeJS.Timeout;
      }
    | null = null;

  public constructor(wsUrl: string | undefined, connectTimeoutMs: number) {
    this.url = wsUrl;
    this.connectTimeoutMs = connectTimeoutMs;
  }

  public isEnabled(): boolean {
    return Boolean(this.url);
  }

  public getState(): "disabled" | "closed" | "connecting" | "open" {
    if (!this.url) return "disabled";
    if (!this.ws) return "closed";
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return "connecting";
      case WebSocket.OPEN:
        return "open";
      default:
        return "closed";
    }
  }

  public async ensureConnected(): Promise<ProbeResult> {
    if (!this.url) return { ok: false, error: "disabled" };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) return { ok: true, latencyMs: 0 };

    if (this.ws && (this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING)) {
      this.ws.removeAllListeners();
      this.ws = null;
    }

    const start = Date.now();
    try {
      await this.connectOnce(this.url, this.connectTimeoutMs);
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err: unknown) {
      return { ok: false, latencyMs: Date.now() - start, error: this.errToString(err) };
    }
  }

  public async pingPong(timeoutMs: number): Promise<WsPingResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return { ok: false, error: "not connected" };

    const ws = this.ws;
    const start = Date.now();
    let settled = false;

    return await new Promise<WsPingResult>((resolve) => {
      const onPong = () => {
        this.lastPongIso = nowIso();
        finish({ ok: true, latencyMs: Date.now() - start, lastPongIso: this.lastPongIso });
      };
      const onClose = () => finish({ ok: false, error: "socket closed" });
      const onErr = (e: unknown) => finish({ ok: false, error: this.errToString(e) });

      const timer = setTimeout(() => {
        finish({ ok: false, error: `timeout after ${timeoutMs}ms` });
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        ws.removeListener("pong", onPong);
        ws.removeListener("close", onClose);
        ws.removeListener("error", onErr);
      };

      const finish = (r: WsPingResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(r);
      };

      ws.once("pong", onPong);
      ws.once("close", onClose);
      ws.once("error", onErr);

      try {
        ws.ping();
      } catch (e: unknown) {
        finish({ ok: false, error: this.errToString(e) });
      }
    });
  }

  public async close(): Promise<void> {
    const ws = this.ws;
    this.ws = null;
    if (this.mudPending) this.finishMudPending({ ok: false, error: "socket closed" });
    if (!ws) return;

    await new Promise<void>((resolve) => {
      try {
        ws.once("close", () => resolve());
        ws.close();
      } catch {
        resolve();
      }
    });
  }

  private connectOnce(url: string, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);

      let settled = false;
      const finishOk = () => {
        if (settled) return;
        settled = true;
        cleanup();

        // Wire message handler once per connection.
        ws.on("message", (data) => this.onMessage(data));
        this.ws = ws;
        resolve();
      };
      const finishErr = (e: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(e);
      };

      const timer = setTimeout(() => finishErr(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        ws.removeListener("open", finishOk);
        ws.removeListener("error", finishErr);
      };

      ws.once("open", finishOk);
      ws.once("error", finishErr);
    });
  }

  private onMessage(data: WebSocket.RawData): void {
    if (!this.mudPending) return;

    let raw = "";
    try {
      raw = typeof data === "string" ? data : data.toString("utf-8");
    } catch {
      return;
    }

    const trimmed = raw.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return;

    let msg: any;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }

    // Be tolerant: different servers may name fields differently.
    const op = typeof msg?.op === "string" ? msg.op : typeof msg?.type === "string" ? msg.type : null;
    if (op !== "mud_result" && op !== "mudResult" && op !== "mud.result") return;

    const output =
      typeof msg?.output === "string"
        ? msg.output
        : typeof msg?.text === "string"
          ? msg.text
          : typeof msg?.payload?.text === "string"
            ? msg.payload.text
            : typeof msg?.payload?.output === "string"
              ? msg.payload.output
              : "";

    this.finishMudPending({ ok: true, output });
  }

  private finishMudPending(r: { ok: boolean; output?: string; error?: string }): void {
    const pending = this.mudPending;
    if (!pending) return;
    this.mudPending = null;
    clearTimeout(pending.timer);
    pending.resolve({ ...r, latencyMs: Date.now() - pending.startedAt });
  }

  public async mudCommand(command: string, timeoutMs: number): Promise<{ ok: boolean; output?: string; error?: string }>
  {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return { ok: false, error: "not connected" };
    if (this.mudPending) return { ok: false, error: "mud command already in flight" };

    const ws = this.ws;
    const startedAt = Date.now();

    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.finishMudPending({ ok: false, error: `timeout after ${timeoutMs}ms` });
      }, timeoutMs);

      this.mudPending = { startedAt, resolve, timer };

      try {
        ws.send(JSON.stringify({ op: "mud", payload: { text: command } }));
      } catch (e: unknown) {
        this.finishMudPending({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    });
  }

  private errToString(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}

type StatusState = {
  lastSnapshot: TickSnapshot | null;
  lastSnapshotIso: string | null;
  lastChangeIso: string | null;
  lastSignature: string | null;
  goals: {
    state: GoalsState;
    lastReport: GoalRunReport | null;
  };
};

function deriveGoalsReportDir(cfg: MotherBrainConfig): string | undefined {
  if (cfg.goalsReportDir && cfg.goalsReportDir.trim().length > 0) {
    return path.resolve(cfg.goalsReportDir.trim());
  }

  // If PW_FILELOG is set, drop reports into its directory under mother-brain/.
  const pw = process.env.PW_FILELOG;
  if (pw && pw.trim().length > 0) {
    const baseDir = path.dirname(pw);
    return path.resolve(baseDir, "mother-brain");
  }

  return undefined;
}

async function readJsonBody(req: http.IncomingMessage, maxBytes = 128 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += b.length;
    if (total > maxBytes) throw new Error("body too large");
    chunks.push(b);
  }

  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (raw.length === 0) return null;
  return JSON.parse(raw) as unknown;
}

function computeSignature(s: TickSnapshot): string {
  const parts = [
    `db:${s.db.enabled ? "on" : "off"}:${s.db.ok ? "ok" : "bad"}`,
    `ws:${s.ws.enabled ? "on" : "off"}:${s.ws.state}:${s.ws.ok ? "ok" : "bad"}`,
    `wsping:${s.ws.pingOk === undefined ? "na" : s.ws.pingOk ? "ok" : "bad"}`,
    `schema:${s.db.spawnPointsSchema ? s.db.spawnPointsSchema.missingColumns.join(",") : "na"}`,
  ];
  return parts.join("|");
}

function isReady(s: TickSnapshot): boolean {
  if (s.db.enabled && !s.db.ok) return false;
  if (s.ws.enabled && s.ws.state !== "open") return false;
  return true;
}

function startHttpServer(cfg: MotherBrainConfig, state: StatusState): http.Server | null {
  if (!cfg.httpPort || cfg.httpPort <= 0) return null;

  const server = http.createServer(async (req, res) => {
    const rawUrl = req.url || "/";
    const parsedUrl = new URL(rawUrl, "http://localhost");
    const pathname = parsedUrl.pathname;

    if (pathname === "/healthz") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, ts: nowIso() }));
      return;
    }

    if (pathname === "/readyz") {
      const snap = state.lastSnapshot;
      const snapOk = snap ? isReady(snap) : false;

      const goalsEnabled = state.goals.state.everyTicks > 0;
      const goalsHealth = computeGoalsHealth(state.goals.state);
      const goalsOk = goalsHealth.status === "OK";

      const ok = cfg.readyRequiresGoalsOk && goalsEnabled ? snapOk && goalsOk : snapOk;
      res.statusCode = ok ? 200 : 503;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ok,
          ts: nowIso(),
          lastSnapshotIso: state.lastSnapshotIso,
          signature: state.lastSignature,
          goals: {
            enabled: goalsEnabled,
            requireOk: cfg.readyRequiresGoalsOk,
            status: goalsHealth.status,
            lastRunIso: goalsHealth.lastRunIso,
            ageSec: goalsHealth.ageSec,
            lastOk: state.goals.state.lastOk,
            lastSummary: state.goals.state.lastSummary,
          },
        })
      );
      return;
    }

    if (pathname === "/status") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ts: nowIso(),
          lastSnapshotIso: state.lastSnapshotIso,
          lastChangeIso: state.lastChangeIso,
          signature: state.lastSignature,
          snapshot: state.lastSnapshot,
        })
      );
      return;
    }

    // ---------------------------------------------------------------------
    // Goals runner endpoints (safe; observe-only)
    // ---------------------------------------------------------------------

    if (pathname === "/goals" && req.method === "GET") {
      const suites = getGoalSuites(state.goals.state);
      const health = computeGoalsHealth(state.goals.state);
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ok: true,
          ts: nowIso(),
          everyTicks: state.goals.state.everyTicks,
          filePath: state.goals.state.filePath,
          reportDir: state.goals.state.reportDir,
          packIds: state.goals.state.packIds,
          inMemory: Boolean(state.goals.state.inMemoryGoals),
          suites,
          activeGoals: getActiveGoals(state.goals.state),
          lastRunIso: state.goals.state.lastRunIso,
          lastOk: state.goals.state.lastOk,
          lastSummary: state.goals.state.lastSummary,
          lastBySuite: state.goals.state.lastBySuite ?? null,
          health,
        })
      );
      return;
    }

    // Convenience: return the most recent goals run report (human-friendly JSON).
    // This is written by the goals runner as mother-brain-goals-last.json under reportDir.
    if (pathname === "/goals/last" && req.method === "GET") {
      const reportDir = state.goals.state.reportDir;
      const filePath = reportDir ? path.resolve(reportDir, "mother-brain-goals-last.json") : null;

      if (!filePath || !fs.existsSync(filePath)) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: false, ts: nowIso(), error: "last report not found", reportDir }));
        return;
      }

      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, ts: nowIso(), reportDir, filePath, report: parsed }));
        return;
      } catch (e: unknown) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            ok: false,
            ts: nowIso(),
            error: e instanceof Error ? e.message : String(e),
            reportDir,
            filePath,
          })
        );
        return;
      }
    }

    // List recent goals run files (JSONL) in reportDir.
    // Useful for debugging historical runs without shell access.
    //
    // GET /goals/runs?limit=20
    if (pathname === "/goals/runs" && req.method === "GET") {
      const reportDir = state.goals.state.reportDir;
      const limit = Math.max(1, Math.min(200, Number(parsedUrl.searchParams.get("limit") ?? "20") || 20));

      if (!reportDir || !fs.existsSync(reportDir)) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: false, ts: nowIso(), error: "reportDir not configured", reportDir }));
        return;
      }

      try {
        const entries = fs
          .readdirSync(reportDir, { withFileTypes: true })
          .filter((d) => d.isFile())
          .map((d) => d.name)
          .filter((n) => n.endsWith(".jsonl") && n.startsWith("mother-brain-goals-"));

        const files = entries
          .map((name) => {
            const filePath = path.resolve(reportDir, name);
            const st = fs.statSync(filePath);
            return {
              name,
              filePath,
              sizeBytes: st.size,
              mtimeIso: st.mtime.toISOString(),
            };
          })
          .sort((a, b) => (a.mtimeIso < b.mtimeIso ? 1 : a.mtimeIso > b.mtimeIso ? -1 : 0))
          .slice(0, limit);

        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, ts: nowIso(), reportDir, files }));
        return;
      } catch (e: unknown) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: false, ts: nowIso(), reportDir, error: e instanceof Error ? e.message : String(e) }));
        return;
      }
    }

    // Tail a recent JSONL report file by suite id.
    //
    // GET /goals/recent?suite=all_smoke&limit=100
    if (pathname === "/goals/recent" && req.method === "GET") {
      const reportDir = state.goals.state.reportDir;
      const suite = (parsedUrl.searchParams.get("suite") ?? "").trim();
      const limit = Math.max(1, Math.min(500, Number(parsedUrl.searchParams.get("limit") ?? "100") || 100));

      if (!reportDir || !fs.existsSync(reportDir)) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: false, ts: nowIso(), error: "reportDir not configured", reportDir }));
        return;
      }
      if (!suite) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: false, ts: nowIso(), error: "missing suite param" }));
        return;
      }

      // Match today's report file name convention.
      // Note: suite is sanitized in Goals.ts the same way; keep it consistent here.
      const safeSuite = suite
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-/g, "")
        .replace(/-$/g, "")
        .slice(0, 64);

      const today = new Date().toISOString().slice(0, 10);
      const filePath = path.resolve(reportDir, `mother-brain-goals-${safeSuite || "suite"}-${today}.jsonl`);

      if (!fs.existsSync(filePath)) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: false, ts: nowIso(), error: "report file not found", reportDir, suite, filePath }));
        return;
      }

      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const lines = raw
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0);

        const tail = lines.slice(-limit);
        // Best-effort parse each line as JSON. If parse fails, include raw.
        const parsed = tail.map((l) => {
          try {
            return JSON.parse(l) as unknown;
          } catch {
            return { raw: l };
          }
        });

        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, ts: nowIso(), reportDir, suite, filePath, limit, lines: parsed }));
        return;
      } catch (e: unknown) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: false, ts: nowIso(), reportDir, suite, filePath, error: e instanceof Error ? e.message : String(e) }));
        return;
      }
    }

    if (pathname === "/goals/set" && req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        const goals = Array.isArray(body) ? (body as GoalDefinition[]) : null;
        setInMemoryGoals(state.goals.state, goals);
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, ts: nowIso(), inMemory: Boolean(goals) }));
      } catch (e: unknown) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }

    if (pathname === "/goals/clear" && req.method === "POST") {
      setInMemoryGoals(state.goals.state, null);
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, ts: nowIso(), inMemory: false }));
      return;
    }

    if (pathname === "/goals/run" && req.method === "POST") {
      // Run goals immediately using the last known snapshot context.
      // Note: DB querying is not available from this endpoint (by design).
      try {
        const tick = state.lastSnapshot?.tick ?? 0;
        const wb = state.lastSnapshot?.db.brainWaveBudget ?? null;
        const wsState = state.lastSnapshot?.ws.state ?? "disabled";

        const suiteRun = await runGoalSuites(state.goals.state, {
          nowIso,
          dbQuery: async () => {
            throw new Error("db_query unavailable from HTTP endpoint; rely on scheduled runs");
          },
          waveBudget:
            wb && wb.ok
              ? { ok: true, breaches: wb.breaches }
              : wb && !wb.ok
                ? { ok: false, reason: wb.reason }
                : null,
          wsState,
          wsDisabledReason: wsState === "disabled" ? (cfg.wsUrl ? "ws probe disabled" : "MOTHER_BRAIN_WS_URL not set") : undefined,
          wsRequired: cfg.wsRequired,
          log,
        }, tick);

        state.goals.lastReport = suiteRun.overall;
        res.statusCode = suiteRun.ok ? 200 : 503;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: suiteRun.ok, ts: nowIso(), bySuite: suiteRun.bySuite, overall: suiteRun.overall }));
      } catch (e: unknown) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }

    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  });

  server.listen(cfg.httpPort, cfg.httpHost, () => {
    log("info", "HTTP status server listening", { host: cfg.httpHost, port: cfg.httpPort });
  });

  return server;
}

async function main(): Promise<void> {
  // Optional file logging (same mechanism as MMO backend).
  // Set PW_FILELOG to enable, e.g.:
  //   export PW_FILELOG=/home/rimuru/planarwar/log/{scope}.log
  installFileLogTap();

  loadDotEnv();
  bridgePwDbEnv();

  if (!process.env.MOTHER_BRAIN_DB_URL) {
    process.env.MOTHER_BRAIN_DB_URL = process.env.PW_DATABASE_URL || process.env.DATABASE_URL;
  }

  const cfg = parseConfig();
  const startedAt = Date.now();

  // Identity for service_heartbeats (best-effort; never blocks startup).
  const hbHost = process.env.HOSTNAME || process.env.HOST || os.hostname() || "unknown";
  const hbInstanceId = `${hbHost}:${process.pid}`;
  const hbVersion = getServiceVersion();

  const gatedLog = (level: LogLevel, msg: string, extra?: Record<string, unknown>) => {
    if (shouldLog(level, cfg.logLevel)) log(level, msg, extra);
  };

  const goalsFileAbs = cfg.goalsFile ? path.resolve(cfg.goalsFile) : undefined;
  const goalsReportDir = deriveGoalsReportDir(cfg);

  const dbProbe = new DbProbe(cfg.dbUrl, cfg.dbTimeoutMs);
  const wsProbe = new WsProbe(cfg.wsUrl, cfg.wsTimeoutMs);

  gatedLog("info", "Boot", {
    mode: cfg.mode,
    tickMs: cfg.tickMs,
    logLevel: cfg.logLevel,
    tickLogEveryTicks: cfg.tickLogEveryTicks,
    tickLogOnChange: cfg.tickLogOnChange,
    heartbeatEveryTicks: cfg.heartbeatEveryTicks,
    httpPort: cfg.httpPort,
    hasDbUrl: Boolean(cfg.dbUrl),
    hasWsUrl: Boolean(cfg.wsUrl),
    goalsEveryTicks: cfg.goalsEveryTicks,
    goalsFile: goalsFileAbs,
    goalsPacks: cfg.goalsPacks,
    goalsReportDir,
    pid: process.pid,
    node: process.version,
  });

  if (cfg.mode === "apply") {
    gatedLog("warn", "MOTHER_BRAIN_MODE=apply is set, but v0.10.1 remains observe-only (no mutations).");
  }

  // Cache DB metadata once (best-effort).
  let serverVersion: string | null = null;
  let dbName: string | null = null;
  if (dbProbe.isEnabled()) {
    serverVersion = await dbProbe.getServerVersion();
    dbName = await dbProbe.getCurrentDatabase();
  }

  let stopping = false;

  const state: StatusState = {
    lastSnapshot: null,
    lastSnapshotIso: null,
    lastChangeIso: null,
    lastSignature: null,
    goals: {
      state: createGoalsState({
        filePath: goalsFileAbs,
        reportDir: goalsReportDir,
        everyTicks: cfg.goalsEveryTicks,
        packIds: cfg.goalsPacks,
        webBackendHttpBase: cfg.webBackendHttpBase,
        webBackendAdminToken: cfg.webBackendAdminToken,
        webBackendServiceToken: cfg.webBackendServiceToken,
        webBackendServiceTokenReadonly: cfg.webBackendServiceTokenReadonly,
        webBackendServiceTokenEditor: cfg.webBackendServiceTokenEditor,
        mmoBackendHttpBase: cfg.mmoBackendHttpBase,
        mmoBackendServiceToken: cfg.mmoBackendServiceToken,
        mmoBackendServiceTokenReadonly: cfg.mmoBackendServiceTokenReadonly,
        mmoBackendServiceTokenEditor: cfg.mmoBackendServiceTokenEditor,
      }),
      lastReport: null,
    },
  };

  let httpServer: http.Server | null = null;
  httpServer = startHttpServer(cfg, state);

  const shutdown = async (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;

    gatedLog("info", "Shutdown requested", { signal });

    await wsProbe.close().catch(() => undefined);
    await dbProbe.close().catch(() => undefined);

    if (httpServer) {
      await new Promise<void>((resolve) => {
        try {
          httpServer!.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }

    gatedLog("info", "Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  let tick = 0;

  // Alert dedupe: emit a loud failure summary once per goal run.
  let lastGoalsAlertRunIso: string | null = null;

  while (!stopping) {
    tick += 1;

    const uptimeMs = Date.now() - startedAt;

    const dbRes = dbProbe.isEnabled() ? await dbProbe.ping() : ({ ok: false, error: "disabled" } as ProbeResult);
    const wsRes = wsProbe.isEnabled()
      ? await wsProbe.ensureConnected()
      : ({ ok: false, error: "disabled" } as ProbeResult);

    const shouldPingWs = wsProbe.isEnabled() && cfg.wsPingEveryTicks > 0 && tick % cfg.wsPingEveryTicks === 0;
    let wsPing: WsPingResult | null = null;
    if (shouldPingWs && wsRes.ok) {
      wsPing = await wsProbe.pingPong(cfg.wsPingTimeoutMs);
    }

    let brainSpawns: BrainSpawnSummary | null | undefined = undefined;
    const shouldSummarize =
      dbProbe.isEnabled() && cfg.spawnSummaryEveryTicks > 0 && tick % cfg.spawnSummaryEveryTicks === 0;
    if (shouldSummarize && dbRes.ok) {
      brainSpawns = await dbProbe.getBrainSpawnSummary(cfg.spawnSummaryTopN);
    }

    let spawnPointsSchema: SpawnPointsSchemaProbe | null | undefined = undefined;
    const shouldProbeSchema =
      dbProbe.isEnabled() && cfg.schemaProbeEveryTicks > 0 && tick % cfg.schemaProbeEveryTicks === 0;
    if (shouldProbeSchema && dbRes.ok) {
      spawnPointsSchema = await dbProbe.probeSpawnPointsSchema();
    }


    // v0.11: optional wave-budget probe (cheap, best-effort)
    const shouldBudget =
      dbProbe.isEnabled() &&
      cfg.brainWaveBudgetEveryTicks > 0 &&
      tick % cfg.brainWaveBudgetEveryTicks === 0 &&
      dbRes.ok;
    const brainWaveBudget = shouldBudget ? await probeBrainWaveBudget(dbProbe, cfg) : null;

    // v0.20: optional goals runner (structured JSONL reports)
    const shouldRunGoals =
      cfg.goalsEveryTicks > 0 && tick % cfg.goalsEveryTicks === 0 && (dbProbe.isEnabled() || wsProbe.isEnabled());
    if (shouldRunGoals) {
      try {
        const wbForGoals =
          brainWaveBudget && brainWaveBudget.ok
            ? { ok: true as const, breaches: brainWaveBudget.breaches }
            : brainWaveBudget && !brainWaveBudget.ok
              ? { ok: false as const, reason: brainWaveBudget.reason }
              : null;

        const suiteRun = await runGoalSuites(state.goals.state, {
          nowIso,
          dbQuery: async (sql: string, params?: any[]) => {
            const r = await dbProbe.query(sql, params);
            if (!r) return null;
            return { rows: r.rows };
          },
          waveBudget: wbForGoals,
          wsState: wsProbe.isEnabled() ? wsProbe.getState() : "disabled",
          wsDisabledReason: wsProbe.isEnabled() ? undefined : (cfg.wsUrl ? "ws probe disabled" : "MOTHER_BRAIN_WS_URL not set"),
          wsRequired: cfg.wsRequired,
          wsMudCommand: wsProbe.isEnabled() ? (cmd: string, timeoutMs: number) => wsProbe.mudCommand(cmd, timeoutMs) : undefined,
          log,
        }, tick);

        state.goals.lastReport = suiteRun.overall;

        // Always tell us when player testing fails, and why.
        if (!suiteRun.ok) {
          const runIso = state.goals.state.lastRunIso;
          if (runIso && runIso !== lastGoalsAlertRunIso) {
            lastGoalsAlertRunIso = runIso;

            const failing = (suiteRun.overall.results ?? []).filter((r) => !r.ok && !(r.details as any)?.skipped);
            const top = failing.slice(0, 8).map((r) => ({
              id: r.id,
              kind: r.kind,
              error: r.error ?? null,
              latencyMs: r.latencyMs ?? null,
            }));

            gatedLog("error", "Goals FAILED", {
              tick,
              runIso,
              suites: Object.keys(suiteRun.bySuite ?? {}),
              summary: suiteRun.overall.summary,
              failingCount: failing.length,
              topFailing: top,
              reportDir: state.goals.state.reportDir,
            });

            if (cfg.goalsFailfast) {
              // Some runtimes/type-defs widen exitCode to string|number; keep this assignment type-safe.
              const curExit = typeof process.exitCode === "number" ? process.exitCode : 0;
              process.exitCode = curExit < 2 ? 2 : curExit;
            }
          }
        }
      } catch (e: unknown) {
        gatedLog("warn", "Goals runner failed", { error: e instanceof Error ? e.message : String(e) });
      }
    }


    const goalsHealth = computeGoalsHealth(state.goals.state);

    const snapshot: TickSnapshot = {
      tick,
      uptimeMs,
      mode: cfg.mode,

      db: {
        enabled: dbProbe.isEnabled(),
        ...(dbProbe.isEnabled() ? dbRes : {}),
        serverVersion,
        dbName,
        ...(brainSpawns !== undefined ? { brainSpawns } : {}),
        ...(spawnPointsSchema !== undefined ? { spawnPointsSchema } : {}),
        ...(brainWaveBudget !== undefined ? { brainWaveBudget } : {}),
      },

      ws: {
        enabled: wsProbe.isEnabled(),
        state: wsProbe.getState(),
        ...(wsProbe.isEnabled() ? wsRes : {}),
        ...(wsPing
          ? {
              pingOk: wsPing.ok,
              pingLatencyMs: wsPing.latencyMs,
              lastPongIso: wsPing.lastPongIso ?? null,
              ...(wsPing.ok ? {} : { pingError: wsPing.error ?? "unknown" }),
            }
          : {}),
      },

      goals: {
        enabled: cfg.goalsEveryTicks > 0,
        everyTicks: cfg.goalsEveryTicks,
        packIds: state.goals.state.packIds,
        filePath: state.goals.state.filePath,
        reportDir: state.goals.state.reportDir,
        lastRunIso: state.goals.state.lastRunIso,
        lastOk: state.goals.state.lastOk,
        lastSummary: state.goals.state.lastSummary,
        // Prefer the derived, UI-ready by-suite summaries when available.
        lastBySuite: goalsHealth.bySuite ?? (state.goals.state.lastBySuite as any),
        health: goalsHealth,
      },
    };

    // Update HTTP-visible state
    const snapIso = nowIso();
    state.lastSnapshot = snapshot;
    state.lastSnapshotIso = snapIso;

    const sig = computeSignature(snapshot);
    const changed = state.lastSignature !== sig;
    if (changed) {
      state.lastSignature = sig;
      state.lastChangeIso = snapIso;
    }

    // v0.8: rate-limited logging
    const cadenceHit = tick % cfg.tickLogEveryTicks === 0;
    const shouldLogTick = cadenceHit || (cfg.tickLogOnChange && changed);
    if (shouldLogTick) gatedLog("info", "Tick", snapshot);

    // v0.10: best-effort DB heartbeat
    const shouldHeartbeat =
      dbProbe.isEnabled() && cfg.heartbeatEveryTicks > 0 && tick % cfg.heartbeatEveryTicks === 0 && dbRes.ok;

    if (shouldHeartbeat) {
      void dbProbe.writeHeartbeat(
        "mother-brain",
        hbInstanceId,
        hbHost,
        process.pid,
        hbVersion,
        cfg.mode,
        isReady(snapshot),
        tick,
        sig,
        snapshot
      );
    }

    await sleep(cfg.tickMs);
  }
}

main().catch((err) => {
  log("error", "Fatal error", { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
