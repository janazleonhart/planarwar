//worldcore/db/Database.ts

// Planar War – DB & Redis connection layer (legacy v1, parked)
//
// This is a direct port of the old Database.ts into the new worldcore tree.
// We are NOT wiring it into the MMO yet; it's here so that when we turn on
// Postgres/Redis-backed shard storage, the shape is already in place.

import { Pool } from "pg";
import { createClient } from "redis";
import dotenv from "dotenv";

import { Logger } from "../utils/logger";

dotenv.config();

const log = Logger.scope("DB");

// -----------------------------
// Postgres connection
// -----------------------------

export const db = new Pool({
  host: process.env.PW_DB_HOST,
  port: parseInt(process.env.PW_DB_PORT || "5432", 10),
  user: process.env.PW_DB_USER,
  password: process.env.PW_DB_PASS,
  database: process.env.PW_DB_NAME,
  max: parseInt(process.env.PW_DB_POOL_SIZE || "10", 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

db.on("error", (err: any) => {
  log.error("Postgres pool error", err);
});

// Optional: tiny helper to test connectivity on startup if/when we wire it.
export async function testDbConnection(): Promise<void> {
  try {
    const r = await db.query("SELECT 1 AS ok");
    log.success("Postgres connected", { ok: r.rows[0]?.ok });
  } catch (err) {
    log.error("Postgres connection test failed", err);
  }
}

// -----------------------------
// Redis connection
// -----------------------------

const redisLog = Logger.scope("REDIS");

export const redis = createClient({
  url: process.env.PW_REDIS_URL ?? "redis://localhost:6379",
});

redis.on("ready", () => redisLog.success("Redis connected"));
redis.on("error", (err) => redisLog.error("Redis error", err));

// IMPORTANT:
// We don't force this to run at process startup yet. When some future
// subsystem *actually* needs Redis, it can call `ensureRedisConnected()`.
// That avoids “random connection attempt on import” issues during early dev.

let redisConnecting = false;

export async function ensureRedisConnected(): Promise<void> {
  if (redisConnecting) return;
  redisConnecting = true;

  try {
    await redis.connect();
  } catch (err) {
    redisLog.error("Redis connect failed", err);
    redisConnecting = false;
    throw err;
  }
}
