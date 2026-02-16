//mother-brain/index.ts

import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { z } from "zod";

type LogLevel = "debug" | "info" | "warn" | "error";

function nowIso(): string {
  return new Date().toISOString();
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
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", ".env"),
  ];

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

const ConfigSchema = z
  .object({
    MOTHER_BRAIN_TICK_MS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : 5000))
      .refine((n) => Number.isFinite(n) && n >= 250, {
        message: "MOTHER_BRAIN_TICK_MS must be a number >= 250",
      }),

    MOTHER_BRAIN_LOG_LEVEL: z
      .enum(["debug", "info", "warn", "error"])
      .optional()
      .default("info"),

    // Reserved for future slices:
    // - connecting to postgres directly for wave planning/status
    // - connecting to shard websocket(s) for GoalRunner
    MOTHER_BRAIN_DB_URL: z.string().optional(),
    MOTHER_BRAIN_WS_URL: z.string().optional(),
  })
  .passthrough();

type MotherBrainConfig = {
  tickMs: number;
  logLevel: LogLevel;
  dbUrl?: string;
  wsUrl?: string;
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
    tickMs: env.MOTHER_BRAIN_TICK_MS,
    logLevel: env.MOTHER_BRAIN_LOG_LEVEL,
    dbUrl: env.MOTHER_BRAIN_DB_URL,
    wsUrl: env.MOTHER_BRAIN_WS_URL,
  };
}

function shouldLog(level: LogLevel, configured: LogLevel): boolean {
  const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  return order[level] >= order[configured];
}

async function main(): Promise<void> {
  loadDotEnv();

  const cfg = parseConfig();

  const gatedLog = (level: LogLevel, msg: string, extra?: Record<string, unknown>) => {
    if (shouldLog(level, cfg.logLevel)) log(level, msg, extra);
  };

  gatedLog("info", "Boot", {
    tickMs: cfg.tickMs,
    logLevel: cfg.logLevel,
    hasDbUrl: Boolean(cfg.dbUrl),
    hasWsUrl: Boolean(cfg.wsUrl),
    pid: process.pid,
    node: process.version,
  });

  let ticks = 0;
  const interval = setInterval(() => {
    ticks += 1;
    gatedLog("debug", "Heartbeat", { ticks });
  }, cfg.tickMs);

  const shutdown = async (signal: NodeJS.Signals) => {
    gatedLog("info", "Shutdown requested", { signal });
    clearInterval(interval);

    // Future: close DB pool / WS connections here.

    gatedLog("info", "Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Keep process alive.
}

main().catch((err) => {
  log("error", "Fatal error", { message: err?.message ?? String(err) });
  process.exit(1);
});
