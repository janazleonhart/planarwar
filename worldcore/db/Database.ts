// worldcore/db/Database.ts
// Planar War – DB & Redis connection layer
//
// Lane A guardrails:
// - When WORLDCORE_TEST=1, we must NOT create Pool/Redis clients that can hold open handles.
// - Any attempt to touch DB/Redis in unit tests should fail loudly and immediately.

import { Pool } from "pg";
import { createClient } from "redis";
import dotenv from "dotenv";
import { Logger } from "../utils/logger";

// Load environment variables from .env into process.env early.
// Note: dotenv does not validate presence/types.
dotenv.config();

const log = Logger.scope("DB");
const redisLog = Logger.scope("REDIS");

const UNIT_TEST_MODE = process.env.WORLDCORE_TEST === "1";

const UNIT_TEST_BLOCK_MESSAGE =
  "Database/Redis access is disabled under WORLDCORE_TEST=1 (unit tests). " +
  "Run an integration test run without WORLDCORE_TEST if you truly need Postgres.";

function throwUnitTestBlock(): never {
  throw new Error(UNIT_TEST_BLOCK_MESSAGE);
}

// -----------------------------
// Postgres connection
// -----------------------------
export const db: Pool = UNIT_TEST_MODE
  ? ({
      query: async () => throwUnitTestBlock(),
      on: () => {},
      end: async () => {},
    } as any as Pool)
  : new Pool({
      host: process.env.PW_DB_HOST,
      port: parseInt(process.env.PW_DB_PORT || "5432", 10),
      user: process.env.PW_DB_USER,
      password: process.env.PW_DB_PASS,
      database: process.env.PW_DB_NAME,
      max: parseInt(process.env.PW_DB_POOL_SIZE || "10", 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

if (!UNIT_TEST_MODE) {
  // The pool emits "error" on unexpected errors on idle clients.
  db.on("error", (err: unknown) => {
    log.error("Postgres pool error", { err });
  });
}

/**
 * Optional: quick connectivity smoke test, e.g. during server startup.
 *
 * Behavior:
 * - On success: logs "Postgres connected"
 * - On failure: logs error; does not throw (caller decides fail-fast policy)
 *
 * In unit tests, this throws immediately.
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
      url: process.env.PW_REDIS_URL ?? "redis://localhost:6379",
    });

if (!UNIT_TEST_MODE) {
  redis.on("ready", () => redisLog.success("Redis connected"));
  redis.on("error", (err: unknown) => redisLog.error("Redis error", { err }));
}

let redisConnecting = false;

/**
 * Lazily connect the shared Redis client.
 *
 * In unit tests, this throws immediately.
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
