// worldcore/db/Database.ts
// Planar War – DB & Redis connection layer
//
// Guardrails:
// - When WORLDCORE_TEST=1, we must NOT create Pool/Redis clients that can hold open handles.
// - Any attempt to touch DB/Redis in unit tests should fail loudly and immediately.

import { Pool } from "pg";
import { createClient } from "redis";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { Logger } from "../utils/logger";

const log = Logger.scope("DB");
const redisLog = Logger.scope("REDIS");

// Detect unit-test mode as early as possible.
const UNIT_TEST_MODE = process.env.WORLDCORE_TEST === "1";
const UNIT_TEST_BLOCK_MESSAGE =
  "Database/Redis access is disabled under WORLDCORE_TEST=1 (unit tests).\n" +
  "Run an integration test run without WORLDCORE_TEST if you truly need Postgres.";

function throwUnitTestBlock(): never {
  throw new Error(UNIT_TEST_BLOCK_MESSAGE);
}

type EnvLoadResult = {
  loadedFrom?: string;
  tried: string[];
};

function tryLoadEnvFile(envPath: string, tried: string[]): boolean {
  tried.push(envPath);
  try {
    if (!fs.existsSync(envPath)) return false;

    // NOTE: Some dotenv typings in this repo appear to type config() as void.
    // We don’t rely on its return value; we validate success by checking env vars later.
    dotenv.config({ path: envPath });

    return true;
  } catch {
    return false;
  }
}

/**
 * Load environment variables.
 *
 * Problem this solves:
 * - In a monorepo, workspace scripts often run with cwd=.../worldcore
 * - dotenv.config() then loads worldcore/.env (if any) and misses repo-root .env
 *
 * Strategy:
 * - Load default dotenv (cwd)
 * - If PW_DB_USER / PW_DB_NAME not present, try a few likely .env locations
 */
function loadEnv(): EnvLoadResult {
  const tried: string[] = [];

  // Default behavior: dotenv looks for ".env" in process.cwd()
  tried.push(path.resolve(process.cwd(), ".env (dotenv default)"));
  dotenv.config();

  // If already present, we’re done.
  if (process.env.PW_DB_USER && process.env.PW_DB_NAME) {
    return { tried };
  }

  // Candidate paths (best-effort):
  // - cwd/.env (explicit)
  // - parent dirs from cwd
  // - repo root relative to this module (works for both src and dist layouts)
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../.env"),
    path.resolve(process.cwd(), "../../.env"),

    // If running from src: worldcore/db => ../../.env is repo root
    path.resolve(__dirname, "../../.env"),

    // If running from dist: dist/worldcore/db => ../../../.env is repo root
    path.resolve(__dirname, "../../../.env"),

    // One more level up for weird layouts
    path.resolve(__dirname, "../../../../.env"),
  ];

  for (const p of candidates) {
    const attempted = tryLoadEnvFile(p, tried);

    // Success means “required vars exist now”, not “dotenv returned a value”.
    if (attempted && process.env.PW_DB_USER && process.env.PW_DB_NAME) {
      return { loadedFrom: p, tried };
    }
  }

  return { tried };
}

const envLoad = loadEnv();

// -----------------------------
// Helpers
// -----------------------------
function envAny(keys: string[], opts?: { defaultValue?: string }): string | undefined {
  for (const k of keys) {
    const v = process.env[k];
    if (v !== undefined && v !== null && String(v).length > 0) return String(v);
  }
  return opts?.defaultValue;
}

function requireEnvAny(keys: string[], hint: string): string {
  const v = envAny(keys);
  if (v === undefined) {
    const tried = envLoad.tried.map((p) => `- ${p}`).join("\n");
    const loadedFrom = envLoad.loadedFrom ? `Loaded from: ${envLoad.loadedFrom}\n` : "";
    throw new Error(
      `Missing required env var(s): ${keys.join(" or ")}\n` +
        loadedFrom +
        `Tried .env paths:\n${tried}\n\n` +
        hint,
    );
  }
  return v;
}

// -----------------------------
// Postgres connection
// -----------------------------

export const db: Pool = UNIT_TEST_MODE
  ? ({
      query: async () => throwUnitTestBlock(),
      on: () => {},
      end: async () => {},
      connect: async () => throwUnitTestBlock(),
    } as any as Pool)
  : (() => {
      const host = envAny(["PW_DB_HOST"], { defaultValue: "localhost" })!;
      const portStr = envAny(["PW_DB_PORT"], { defaultValue: "5432" })!;
      const user = requireEnvAny(
        ["PW_DB_USER"],
        "Set PW_DB_USER / PW_DB_NAME (and PW_DB_PASS) in your repo-root .env, or export them in your shell.",
      );
      const database = requireEnvAny(
        ["PW_DB_NAME"],
        "Set PW_DB_USER / PW_DB_NAME (and PW_DB_PASS) in your repo-root .env, or export them in your shell.",
      );

      // Ensure password is ALWAYS a string (pg+SCRAM requires string).
      const password = envAny(["PW_DB_PASS", "PW_DB_PASSWORD", "PGPASSWORD"], { defaultValue: "" })!;

      if (!password && !UNIT_TEST_MODE) {
        log.warn("PW_DB_PASS is empty or missing; using empty password. If SCRAM auth is enabled, set PW_DB_PASS.");
      }

      const max = parseInt(envAny(["PW_DB_POOL_SIZE"], { defaultValue: "10" })!, 10);
      const port = parseInt(portStr, 10);

      return new Pool({
        host,
        port: Number.isFinite(port) ? port : 5432,
        user,
        password,
        database,
        max: Number.isFinite(max) ? max : 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      });
    })();

if (!UNIT_TEST_MODE) {
  db.on("error", (err: unknown) => {
    log.error("Postgres pool error", { err });
  });

  if (envLoad.loadedFrom) {
    log.info("dotenv loaded", { path: envLoad.loadedFrom });
  }
}

/**
 * Optional: quick connectivity smoke test, e.g. during server startup.
 */
export async function testDbConnection(): Promise<void> {
  if (UNIT_TEST_MODE) throwUnitTestBlock();
  try {
    const r = await db.query("SELECT 1 AS ok");
    const ok = (r.rows[0] as any)?.ok;
    log.success("Postgres connected", { ok });
  } catch (err) {
    log.error("Postgres connection test failed", { err });
  }
}

// -----------------------------
// Redis connection
// -----------------------------

export const redis = UNIT_TEST_MODE
  ? ({
      isOpen: false,
      connect: async () => throwUnitTestBlock(),
      on: () => {},
      quit: async () => {},
    } as any)
  : createClient({
      url: envAny(["PW_REDIS_URL"], { defaultValue: "redis://localhost:6379" })!,
    });

if (!UNIT_TEST_MODE) {
  redis.on("ready", () => redisLog.success("Redis connected"));
  redis.on("error", (err: unknown) => redisLog.error("Redis error", { err }));
}

let redisConnecting = false;

/**
 * Lazily connect the shared Redis client.
 */
export async function ensureRedisConnected(): Promise<void> {
  if (UNIT_TEST_MODE) throwUnitTestBlock();
  if (redisConnecting) return;
  redisConnecting = true;

  try {
    await redis.connect();
  } catch (err) {
    redisLog.error("Redis connect failed", { err });
    redisConnecting = false; // allow retries after failure
    throw err;
  }
}
