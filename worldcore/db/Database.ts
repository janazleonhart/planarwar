// worldcore/db/Database.ts
// Planar War – DB & Redis connection layer (legacy v1, parked)
//
// This module centralizes connectivity to Postgres and Redis and exposes:
// - A configured pg Pool (db) ready for queries
// - A helper to test Postgres connectivity at startup (testDbConnection)
// - A lazily-connected Redis client (redis) plus ensureRedisConnected() to opt-in
//
// Design goals:
// - Keep import-time side effects minimal (do not auto-connect to Redis at import)
// - Provide visible, scoped logging for success/failure paths
// - Keep configuration driven by environment variables (12-factor friendly)

import { Pool } from "pg";
import { createClient } from "redis";
import dotenv from "dotenv";
import { Logger } from "../utils/logger";

// Load environment variables from .env into process.env early.
// Note: dotenv only updates process.env – it does not validate presence/types.
// Validation is a separate concern.
dotenv.config();

const log = Logger.scope("DB");

// -----------------------------
// Postgres connection
// -----------------------------

/**
 * Shared Postgres connection pool.
 *
 * Notes:
 * - Pool size (max) defaults to 10 if PW_DB_POOL_SIZE is not set.
 * - idleTimeoutMillis closes idle clients to avoid unbounded socket usage.
 * - connectionTimeoutMillis caps how long to wait for a new connection.
 *
 * Env variables expected (typical):
 *   PW_DB_HOST, PW_DB_PORT, PW_DB_USER, PW_DB_PASS, PW_DB_NAME, PW_DB_POOL_SIZE
 *
 * Edge cases:
 * - If env vars are missing/incorrect, Pool creation still succeeds, but
 *   first query will error. Consider validating configuration separately.
 */
export const db = new Pool({
  host: process.env.PW_DB_HOST,
  port: parseInt(process.env.PW_DB_PORT || "5432", 10),
  user: process.env.PW_DB_USER,
  password: process.env.PW_DB_PASS,
  database: process.env.PW_DB_NAME,
  max: parseInt(process.env.PW_DB_POOL_SIZE || "10", 10),
  idleTimeoutMillis: 30_000, // Close idle clients after 30s
  connectionTimeoutMillis: 5_000, // Fail fast if a new connection cannot be made in 5s
});

// The pool emits "error" on unexpected errors on idle clients.
// This does not mean the pool is unusable, but you should observe/alert on it.
db.on("error", (err: unknown) => {
  log.error("Postgres pool error", { err });
});

/**
 * Optional: quick connectivity smoke test, e.g. during server startup.
 *
 * Usage:
 *   await testDbConnection();
 *
 * Behavior:
 * - On success: logs "Postgres connected" along with the SELECT 1 result.
 * - On failure: logs the error; does not throw (by design), so startup can decide
 *   how to react. If you need to fail-fast, consider rethrowing here or in caller.
 */
export async function testDbConnection(): Promise<void> {
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

const redisLog = Logger.scope("REDIS");

/**
 * Redis client (node-redis v4).
 *
 * Important:
 * - Client is created but NOT connected at import-time.
 * - Call ensureRedisConnected() from subsystems that require Redis.
 * - The URL can encode auth and DB index (e.g. redis://:pass@host:6379/0).
 */
export const redis = createClient({
  url: process.env.PW_REDIS_URL ?? "redis://localhost:6379",
});

// Lifecycle & error visibility:
// - "ready" fires when the client is ready to issue commands.
// - "error" fires for any client error (auth, connection drop, command error, etc).
redis.on("ready", () => redisLog.success("Redis connected"));
redis.on("error", (err: unknown) => redisLog.error("Redis error", { err }));

// IMPORTANT:
// We don't force this to run at process startup yet.
// When some future subsystem actually needs Redis, it can call ensureRedisConnected().
// That avoids “random connection attempt on import” issues during early dev.
//
// Concurrency caveat:
// The simple boolean below prevents overlapping connect() calls, but callers
// that arrive while a connection attempt is in progress will RETURN EARLY and
// will NOT await readiness. If your code must ensure readiness before use,
// make sure the call site awaits the first invocation (or refactor to track
// a shared Promise for proper single-flight behavior).
let redisConnecting = false;

/**
 * Lazily connect the shared Redis client.
 *
 * Contract:
 * - Idempotent with respect to "already connecting": if a connect is in-flight,
 *   subsequent calls return immediately (do not await readiness).
 * - On success: client enters ready state, "ready" event will fire.
 * - On failure: logs error, resets the guard to allow retries, and rethrows.
 *
 * Edge cases:
 * - If the client is already connected (isOpen), connect() will throw in newer
 *   node-redis versions. Callers should generally only call this once or
 *   implement their own check. Here we rely on the guard flag for simplicity.
 * - If the connection later closes, redisConnecting remains true; additional
 *   calls to ensureRedisConnected() will no-op. If you need automatic
 *   reconnect-on-demand semantics, consider:
 *     - Checking redis.isOpen before returning, and
 *     - Tracking a shared Promise instead of a boolean (single-flight).
 */
export async function ensureRedisConnected(): Promise<void> {
  if (redisConnecting) return;
  redisConnecting = true;

  try {
    await redis.connect();
  } catch (err) {
    redisLog.error("Redis connect failed", { err });
    // Allow future attempts after a failed connect
    redisConnecting = false;
    throw err;
  }
}