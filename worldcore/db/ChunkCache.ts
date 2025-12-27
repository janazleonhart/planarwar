// worldcore/db/ChunkCache.ts

// Planar War – Terrain/object chunk cache (Redis-backed, generic).
//
// This is the modernized version of the old Redis chunk cache fossil.
// It does NOT enforce a specific chunk schema; worldgen / terrain
// streaming can decide what to store under a given key.
//
// Nothing in the MMO runtime imports this yet. It is parked here
// so when WGEv3 / TerrainStream v3 come online, we already have
// a shared cache layer ready.

import { redis, ensureRedisConnected } from "./Database";
import { Logger } from "../utils/logger";

const log = Logger.scope("CHUNK_CACHE");

/**
 * Generic chunk payload.
 * Worldgen / terrain can decide on the actual shape, for example:
 *  - height samples
 *  - biome indices
 *  - object IDs
 *  - combined chunk data
 */
export type ChunkPayload = unknown;

export interface ChunkCacheOptions {
  /**
   * Redis key prefix, defaults to "pw:chunk".
   * All keys become `${prefix}:${worldId}:${chunkId}`.
   */
  prefix?: string;

  /**
   * Default TTL for chunks, in seconds.
   * If not provided, chunks do not expire automatically.
   */
  defaultTtlSeconds?: number;
}

export class ChunkCache {
  private readonly prefix: string;
  private readonly defaultTtlSeconds?: number;

  constructor(opts?: ChunkCacheOptions) {
    this.prefix = opts?.prefix ?? "pw:chunk";
    this.defaultTtlSeconds = opts?.defaultTtlSeconds;
  }

  private key(worldId: string, chunkId: string): string {
    return `${this.prefix}:${worldId}:${chunkId}`;
  }

  /**
   * Fetch a chunk from cache.
   * Returns null if not found or on deserialization errors.
   */
  async get(
    worldId: string,
    chunkId: string
  ): Promise<ChunkPayload | null> {
    await ensureRedisConnected();

    const k = this.key(worldId, chunkId);
    const raw = await redis.get(k);
    if (!raw) return null;

    try {
      return JSON.parse(raw);
    } catch (err) {
      log.warn("ChunkCache.get: JSON parse failed, deleting bad key", {
        key: k,
        err,
      });
      await redis.del(k);
      return null;
    }
  }

  /**
   * Store a chunk payload in cache.
   * If ttlSeconds is provided, it overrides the default TTL.
   */
  async set(
    worldId: string,
    chunkId: string,
    payload: ChunkPayload,
    ttlSeconds?: number
  ): Promise<void> {
    await ensureRedisConnected();

    const k = this.key(worldId, chunkId);
    const v = JSON.stringify(payload);

    const ttl = ttlSeconds ?? this.defaultTtlSeconds;

    if (ttl && ttl > 0) {
      await redis.set(k, v, { EX: ttl });
    } else {
      await redis.set(k, v);
    }

    log.debug("ChunkCache.set", {
      key: k,
      ttlSeconds: ttl ?? null,
    });
  }

  /**
   * Delete a cached chunk.
   */
  async delete(worldId: string, chunkId: string): Promise<void> {
    await ensureRedisConnected();

    const k = this.key(worldId, chunkId);
    await redis.del(k);

    log.debug("ChunkCache.delete", { key: k });
  }

  /**
   * Best-effort flush for all chunks under this prefix.
   * Uses a simple SCAN/DEL loop; not intended for hot paths.
   */
  async flushAll(): Promise<void> {
    await ensureRedisConnected();

    const pattern = `${this.prefix}:*`;
    let cursor = "0";
    let total = 0;

    do {
      const [nextCursor, keys] = await redis.scan(cursor, {
        MATCH: pattern,
        COUNT: 100,
      });

      cursor = nextCursor;
      if (keys.length > 0) {
        total += keys.length;
        await redis.del(keys);
      }
    } while (cursor !== "0");

    log.info("ChunkCache.flushAll complete", {
      prefix: this.prefix,
      deletedKeys: total,
    });
  }
}
