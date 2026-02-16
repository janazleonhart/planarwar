// mother-brain/index.ts

import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Pool } from "pg";
import WebSocket from "ws";
import { z } from "zod";

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

type SpawnPointsSchemaProbe = {
  exists: boolean;
  missingColumns: string[];
};

function nowIso(): string {
  return new Date().toISOString();
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

    MOTHER_BRAIN_DB_URL: z.string().optional(),
    MOTHER_BRAIN_WS_URL: z.string().optional(),

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

    // v0.6: Optional schema drift probe for spawn_points (read-only)
    MOTHER_BRAIN_SCHEMA_PROBE_EVERY_TICKS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : 30))
      .refine((n) => Number.isFinite(n) && n >= 1, {
        message: "MOTHER_BRAIN_SCHEMA_PROBE_EVERY_TICKS must be a number >= 1",
      }),
  })
  .passthrough();

type MotherBrainConfig = {
  mode: MotherBrainMode;
  tickMs: number;
  logLevel: LogLevel;

  dbUrl?: string;
  wsUrl?: string;

  dbTimeoutMs: number;
  wsTimeoutMs: number;

  wsPingEveryTicks: number;
  wsPingTimeoutMs: number;

  spawnSummaryEveryTicks: number;
  spawnSummaryTopN: number;

  schemaProbeEveryTicks: number;
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

    dbUrl: env.MOTHER_BRAIN_DB_URL,
    wsUrl: env.MOTHER_BRAIN_WS_URL,

    dbTimeoutMs: env.MOTHER_BRAIN_DB_TIMEOUT_MS,
    wsTimeoutMs: env.MOTHER_BRAIN_WS_TIMEOUT_MS,

    wsPingEveryTicks: env.MOTHER_BRAIN_WS_PING_EVERY_TICKS,
    wsPingTimeoutMs: env.MOTHER_BRAIN_WS_PING_TIMEOUT_MS,

    spawnSummaryEveryTicks: env.MOTHER_BRAIN_SPAWN_SUMMARY_EVERY_TICKS,
    spawnSummaryTopN: env.MOTHER_BRAIN_SPAWN_SUMMARY_TOP_N,

    schemaProbeEveryTicks: env.MOTHER_BRAIN_SCHEMA_PROBE_EVERY_TICKS,
  };
}

function shouldLog(level: LogLevel, configured: LogLevel): boolean {
  const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  return order[level] >= order[configured];
}

type ProbeResult = {
  ok: boolean;
  latencyMs?: number;
  error?: string;
};

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
      const row = res.rows?.[0] as { exists?: boolean; columns?: string[] } | undefined;

      const exists = Boolean(row?.exists);
      const cols = Array.isArray(row?.columns) ? row!.columns : [];
      const missingColumns = exists ? required.filter((c) => !cols.includes(c)) : [...required];

      return { exists, missingColumns: [...missingColumns] };
    } catch {
      return { exists: false, missingColumns: [...required] };
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

type WsPingResult = {
  ok: boolean;
  latencyMs?: number;
  lastPongIso?: string;
  error?: string;
};

class WsProbe {
  private ws: WebSocket | null = null;
  private readonly url: string | undefined;
  private readonly connectTimeoutMs: number;
  private lastPongIso: string | null = null;

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

      const onPong = () => {
        this.lastPongIso = nowIso();
        finish({ ok: true, latencyMs: Date.now() - start, lastPongIso: this.lastPongIso });
      };

      const onClose = () => finish({ ok: false, error: "socket closed" });
      const onErr = (e: unknown) => finish({ ok: false, error: this.errToString(e) });

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

  private errToString(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}

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
};

async function main(): Promise<void> {
  loadDotEnv();
  bridgePwDbEnv();

  if (!process.env.MOTHER_BRAIN_DB_URL) {
    process.env.MOTHER_BRAIN_DB_URL = process.env.PW_DATABASE_URL || process.env.DATABASE_URL;
  }

  const cfg = parseConfig();
  const startedAt = Date.now();

  const gatedLog = (level: LogLevel, msg: string, extra?: Record<string, unknown>) => {
    if (shouldLog(level, cfg.logLevel)) log(level, msg, extra);
  };

  const dbProbe = new DbProbe(cfg.dbUrl, cfg.dbTimeoutMs);
  const wsProbe = new WsProbe(cfg.wsUrl, cfg.wsTimeoutMs);

  gatedLog("info", "Boot", {
    mode: cfg.mode,
    tickMs: cfg.tickMs,
    logLevel: cfg.logLevel,
    hasDbUrl: Boolean(cfg.dbUrl),
    hasWsUrl: Boolean(cfg.wsUrl),
    pid: process.pid,
    node: process.version,
  });

  if (cfg.mode === "apply") {
    gatedLog("warn", "MOTHER_BRAIN_MODE=apply is set, but v0.6 remains observe-only (no mutations).");
  }

  // Cache DB metadata once (best-effort).
  let serverVersion: string | null = null;
  let dbName: string | null = null;
  if (dbProbe.isEnabled()) {
    serverVersion = await dbProbe.getServerVersion();
    dbName = await dbProbe.getCurrentDatabase();
  }

  let stopping = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;

    gatedLog("info", "Shutdown requested", { signal });

    await wsProbe.close().catch(() => undefined);
    await dbProbe.close().catch(() => undefined);

    gatedLog("info", "Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  let tick = 0;
  let spawnPointsSchema: SpawnPointsSchemaProbe | null | undefined = undefined;

  while (!stopping) {
    tick += 1;

    const uptimeMs = Date.now() - startedAt;

    const dbRes = dbProbe.isEnabled() ? await dbProbe.ping() : ({ ok: false, error: "disabled" } as ProbeResult);
    const wsRes = wsProbe.isEnabled() ? await wsProbe.ensureConnected() : ({ ok: false, error: "disabled" } as ProbeResult);

    const shouldPingWs = wsProbe.isEnabled() && cfg.wsPingEveryTicks > 0 && tick % cfg.wsPingEveryTicks === 0;
    let wsPing: WsPingResult | null = null;
    if (shouldPingWs && wsRes.ok) {
      wsPing = await wsProbe.pingPong(cfg.wsPingTimeoutMs);
    }

    let brainSpawns: BrainSpawnSummary | null | undefined = undefined;
    const shouldSummarize = dbProbe.isEnabled() && cfg.spawnSummaryEveryTicks > 0 && tick % cfg.spawnSummaryEveryTicks === 0;
    if (shouldSummarize && dbRes.ok) {
      brainSpawns = await dbProbe.getBrainSpawnSummary(cfg.spawnSummaryTopN);
    }

    const shouldProbeSchema =
      dbProbe.isEnabled() && cfg.schemaProbeEveryTicks > 0 && tick % cfg.schemaProbeEveryTicks === 0;
    if (shouldProbeSchema && dbRes.ok) {
      spawnPointsSchema = await dbProbe.probeSpawnPointsSchema();
    }

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
    };

    gatedLog("info", "Tick", snapshot);

    await sleep(cfg.tickMs);
  }
}

main().catch((err) => {
  log("error", "Fatal error", { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
