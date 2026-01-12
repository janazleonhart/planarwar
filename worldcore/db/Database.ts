// worldcore/db/Database.ts
//
// Goal:
// - Keep db typed as pg.Pool (so existing code compiles unchanged).
// - Avoid creating a Pool at import-time (prevents node --test hangs).
// - Under node --test: provide a Pool-shaped stub that returns empty results.
//
// IMPORTANT:
// - Some pg versions throw weird SCRAM errors if password is not a string.
//   We force password to a string.

import { Pool } from "pg";
import { createClient } from "redis";
import dotenv from "dotenv";
import { Logger } from "../utils/logger";

const log = Logger.scope("DB");
const redisLog = Logger.scope("REDIS");

dotenv.config();

function isNodeTestRuntime(): boolean {
  return (
    process.execArgv.includes("--test") ||
    process.argv.includes("--test") ||
    process.env.NODE_ENV === "test" ||
    process.env.WORLDCORE_TEST === "1"
  );
}

let _pool: Pool | null = null;

function buildPoolConfig(): Record<string, any> {
  return {
    host: process.env.PW_DB_HOST ?? "127.0.0.1",
    port: parseInt(process.env.PW_DB_PORT ?? "5432", 10),
    user: process.env.PW_DB_USER ?? "postgres",
    password: String(process.env.PW_DB_PASS ?? ""), // force string
    database: process.env.PW_DB_NAME ?? "planarwar",
    max: parseInt(process.env.PW_DB_POOL_SIZE ?? "10", 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Newer pg supports this; harmless if ignored.
    // @ts-ignore
    allowExitOnIdle: true,
  };
}

function getPool(): Pool {
  if (_pool) return _pool;

  _pool = new Pool(buildPoolConfig() as any);
  _pool.on("error", (err: unknown) => log.error("Postgres pool error", { err }));
  return _pool;
}

// Pool-shaped stub used ONLY under node --test.
// Keeps TS happy (db is Pool), and keeps tests alive (no sockets).
const testPoolStub: any = {
  async query() {
    return { rows: [], rowCount: 0 };
  },
  async connect() {
    return {
      async query() {
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };
  },
  async end() {},
  on() {},
};

// Export db as a Pool, but via Proxy so we can lazily create the real Pool.
// Under tests, it never creates a real Pool.
export const db: Pool = new Proxy({} as any, {
  get(_target, prop: string | symbol) {
    const backing = isNodeTestRuntime() ? testPoolStub : (getPool() as any);
    const v = backing[prop];
    return typeof v === "function" ? v.bind(backing) : v;
  },
}) as any;

export async function testDbConnection(): Promise<void> {
  if (isNodeTestRuntime()) return;

  try {
    const r: any = await (db as any).query("SELECT 1 AS ok");
    log.success("Postgres connected", { ok: r?.rows?.[0]?.ok ?? null });
  } catch (err) {
    log.error("Postgres connection test failed", { err });
  }
}

// ------------------------------------------------------------
// Redis (opt-in connect; constructing client does not open sockets)
// ------------------------------------------------------------

export const redis = createClient({
  url: process.env.PW_REDIS_URL ?? "redis://localhost:6379",
});

redis.on("ready", () => redisLog.success("Redis connected"));
redis.on("error", (err: unknown) => redisLog.error("Redis error", { err }));

let redisConnecting = false;

export async function ensureRedisConnected(): Promise<void> {
  if (isNodeTestRuntime()) return; // tests should not connect redis

  if ((redis as any).isOpen) return;
  if (redisConnecting) return;
  redisConnecting = true;

  try {
    await redis.connect();
  } catch (err) {
    redisLog.error("Redis connect failed", { err });
    redisConnecting = false;
    throw err;
  }
}
