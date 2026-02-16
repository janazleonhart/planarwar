//mother-brain/index.ts

import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Pool } from "pg";
import WebSocket from "ws";
import { z } from "zod";

type LogLevel = "debug" | "info" | "warn" | "error";
type MotherBrainMode = "observe" | "apply";

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
  // When running via npm workspace, cwd is usually mother-brain/.
  // Prefer a repo-root .env (../.env), but allow a local override (./.env).
  const candidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      log("debug", "Loaded env file", { path: p });
      return;
    }
  }

  // No .env found is allowed; env may be injected by systemd/docker/etc.
  log("debug", "No .env file found (continuing with process.env)");
}

/**
 * Planar War convention: most services use PW_DB_* vars (host/port/user/pass/name).
 * Some places prefer PW_DATABASE_URL / DATABASE_URL.
 *
 * Mother Brain supports BOTH:
 * - Prefer explicit MOTHER_BRAIN_DB_URL if provided.
 * - Else, if PW_DATABASE_URL (or DATABASE_URL) exists, use it.
 * - Else, if PW_DB_* exists, bridge into PW_DATABASE_URL + DATABASE_URL and PG* vars.
 */
function bridgePlanarWarDbEnv(): void {
  // If user provided a direct URL for mother-brain, do nothing.
  if (process.env.MOTHER_BRAIN_DB_URL) return;

  // If already configured, keep it.
  const hasUrl =
    !!process.env.PW_DATABASE_URL ||
    !!process.env.DATABASE_URL ||
    !!process.env.POSTGRES_URL ||
    !!process.env.PG_URL;

  if (hasUrl) {
    const url =
      process.env.PW_DATABASE_URL ||
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.PG_URL;

    if (url && !process.env.MOTHER_BRAIN_DB_URL) process.env.MOTHER_BRAIN_DB_URL = url;
    return;
  }

  const host = process.env.PW_DB_HOST;
  const port = process.env.PW_DB_PORT;
  const user = process.env.PW_DB_USER;
  const pass = process.env.PW_DB_PASS;
  const name = process.env.PW_DB_NAME;

  // If the Planar War vars aren't set, nothing to bridge.
  if (!host || !user || !name) return;

  // Also set PG* vars so any "new Pool()" can use env automatically.
  if (!process.env.PGHOST) process.env.PGHOST = host;
  if (!process.env.PGPORT && port) process.env.PGPORT = port;
  if (!process.env.PGUSER) process.env.PGUSER = user;
  if (!process.env.PGDATABASE) process.env.PGDATABASE = name;
  // Ensure password is always a string.
  if (!process.env.PGPASSWORD) process.env.PGPASSWORD = pass || "";

  // Build a connection string for code paths that prefer a URL.
  // NOTE: omit password segment if blank.
  const encUser = encodeURIComponent(user);
  const encPass = pass ? encodeURIComponent(pass) : "";
  const safePort = port ? String(port) : "5432";

  const auth = encPass ? `${encUser}:${encPass}` : encUser;
  const url = `postgresql://${auth}@${host}:${safePort}/${name}`;

  if (!process.env.PW_DATABASE_URL) process.env.PW_DATABASE_URL = url;
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = url;
  if (!process.env.MOTHER_BRAIN_DB_URL) process.env.MOTHER_BRAIN_DB_URL = url;
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

    // Optional connectors (read-only in v0.3):
    // - Postgres: used for health probe queries (SELECT 1), and future wave planning/status.
    // - WebSocket: used for shard connectivity / future GoalRunner.
    MOTHER_BRAIN_DB_URL: z.string().optional(),
    MOTHER_BRAIN_WS_URL: z.string().optional(),

    // Optional timeouts (ms)
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

  // Bridge Planar War DB env variants into a usable URL (if possible).
  bridgePlanarWarDbEnv();

  const bridgedDbUrl =
    process.env.MOTHER_BRAIN_DB_URL ||
    process.env.PW_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.PG_URL;

  return {
    mode: env.MOTHER_BRAIN_MODE,
    tickMs: env.MOTHER_BRAIN_TICK_MS,
    logLevel: env.MOTHER_BRAIN_LOG_LEVEL,
    dbUrl: bridgedDbUrl,
    wsUrl: env.MOTHER_BRAIN_WS_URL,
    dbTimeoutMs: env.MOTHER_BRAIN_DB_TIMEOUT_MS,
    wsTimeoutMs: env.MOTHER_BRAIN_WS_TIMEOUT_MS,
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
  private meta: { serverVersion?: string; dbName?: string } = {};

  public constructor(dbUrl: string | undefined, timeoutMs: number) {
    this.timeoutMs = timeoutMs;

    // If we have a URL, use it.
    if (dbUrl) {
      this.pool = new Pool({
        connectionString: dbUrl,
        // Keep it conservative — this is just a probe in v0.3.
        max: 2,
      });
      return;
    }

    // If no URL, but PG* env vars exist, pg can connect via environment.
    const hasPgEnv =
      !!process.env.PGHOST ||
      !!process.env.PGUSER ||
      !!process.env.PGDATABASE ||
      !!process.env.PGPORT;

    this.pool = hasPgEnv
      ? new Pool({
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

      // sanity check result shape (defensive)
      const ok = Boolean(res?.rows?.[0]?.ok === 1 || res?.rows?.[0]?.ok === true);

      // Populate lightweight meta once, after first successful query.
      if (ok && (!this.meta.serverVersion || !this.meta.dbName)) {
        await this.populateMeta().catch(() => undefined);
      }

      return { ok, latencyMs };
    } catch (err: unknown) {
      return { ok: false, latencyMs: Date.now() - start, error: this.errToString(err) };
    }
  }

  public getMeta(): { serverVersion?: string; dbName?: string } {
    return { ...this.meta };
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

  private async populateMeta(): Promise<void> {
    if (!this.pool) return;

    // Keep this *very* light: two tiny queries.
    const v = await this.withTimeout(this.pool.query("SHOW server_version"), this.timeoutMs);
    const ver = (v.rows?.[0] as any)?.server_version;
    if (typeof ver === "string" && ver.length) this.meta.serverVersion = ver;

    const d = await this.withTimeout(this.pool.query("SELECT current_database() AS name"), this.timeoutMs);
    const dbName = (d.rows?.[0] as any)?.name;
    if (typeof dbName === "string" && dbName.length) this.meta.dbName = dbName;
  }
}

class WsProbe {
  private ws: WebSocket | null = null;
  private readonly url: string | undefined;
  private readonly timeoutMs: number;

  public constructor(wsUrl: string | undefined, timeoutMs: number) {
    this.url = wsUrl;
    this.timeoutMs = timeoutMs;
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
      case WebSocket.CLOSING:
      case WebSocket.CLOSED:
      default:
        return "closed";
    }
  }

  public async ensureConnected(): Promise<ProbeResult> {
    if (!this.url) return { ok: false, error: "disabled" };

    // If already open, treat as ok.
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return { ok: true, latencyMs: 0 };

    // If we have a dead socket reference, drop it.
    if (this.ws && (this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING)) {
      this.ws.removeAllListeners();
      this.ws = null;
    }

    const start = Date.now();
    try {
      await this.connectOnce(this.url, this.timeoutMs);
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err: unknown) {
      return { ok: false, latencyMs: Date.now() - start, error: this.errToString(err) };
    }
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
    serverVersion?: string;
    dbName?: string;
  };

  ws: {
    enabled: boolean;
    state: "disabled" | "closed" | "connecting" | "open";
    ok?: boolean;
    latencyMs?: number;
    error?: string;
  };
};

async function main(): Promise<void> {
  loadDotEnv();

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
    hasDbUrl: Boolean(cfg.dbUrl) || dbProbe.isEnabled(),
    hasWsUrl: Boolean(cfg.wsUrl),
    pid: process.pid,
    node: process.version,
  });

  // Guardrail reminder: v0.3 is observe-only.
  if (cfg.mode === "apply") {
    gatedLog("warn", "MOTHER_BRAIN_MODE=apply is set, but v0.3 performs no mutations (observe-only probes).");
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

  // Main tick loop (no overlap; each tick awaits probes)
  let tick = 0;
  while (!stopping) {
    tick += 1;

    const uptimeMs = Date.now() - startedAt;

    const dbRes = dbProbe.isEnabled() ? await dbProbe.ping() : ({ ok: false, error: "disabled" } as ProbeResult);
    const wsRes = wsProbe.isEnabled()
      ? await wsProbe.ensureConnected()
      : ({ ok: false, error: "disabled" } as ProbeResult);

    const dbMeta = dbProbe.isEnabled() ? dbProbe.getMeta() : {};

    const snapshot: TickSnapshot = {
      tick,
      uptimeMs,
      mode: cfg.mode,

      db: {
        enabled: dbProbe.isEnabled(),
        ...(dbProbe.isEnabled() ? dbRes : {}),
        ...dbMeta,
      },

      ws: {
        enabled: wsProbe.isEnabled(),
        state: wsProbe.getState(),
        ...(wsProbe.isEnabled() ? wsRes : {}),
      },
    };

    // Emit a structured heartbeat. Default logLevel=info, so this shows up by default.
    gatedLog("info", "Tick", snapshot);

    // Sleep after tick
    await sleep(cfg.tickMs);
  }
}

main().catch((err) => {
  log("error", "Fatal error", { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
