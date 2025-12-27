//worldcore/world/ServerWorldStorage.ts

// Worldgen-side storage glue for Planar War.
// Bridges between a world generator (WGE / ScaledWorldgen / etc.)
// and the database-backed ShardStorage layer.
//
// This is the modernized version of the old ServerWorldStorage fossil:
//  - No old planarwar-backend imports.
//  - Generic over *how* you generate a world.
//  - Uses the new worldcore/db/ShardStorage API.

import { Logger } from "../utils/logger";
import { ShardStorage } from "../db/ShardStorage";
import type { WorldBlueprint } from "../shards/WorldBlueprint";

const log = Logger.scope("WORLD_STORAGE");

/**
 * A generic world generator function.
 *
 * Worldgen pipelines (WGEv2/WGEv3/ScaledWorldgen/etc.) can implement this
 * signature and pass it to ServerWorldStorage. That keeps this glue layer
 * decoupled from any specific WGE implementation.
 */
export type WorldGeneratorFn = (opts: {
  shardId: string;
  name: string;
  seed: number;
}) => Promise<WorldBlueprint> | WorldBlueprint;

export interface ServerWorldStorageOptions {
  /**
   * Human-readable shard / world name.
   * Defaults to "Prime Shard".
   */
  name?: string;

  /**
   * Optional seed override. If not provided, a deterministic hash from
   * shardId is used.
   */
  seedOverride?: number;
}

export class ServerWorldStorage {
  private readonly name: string;
  private readonly seedOverride?: number;

  constructor(
    private readonly shardId: string,
    private readonly storage: ShardStorage,
    private readonly generateWorld: WorldGeneratorFn,
    opts?: ServerWorldStorageOptions
  ) {
    this.name = opts?.name ?? "Prime Shard";
    this.seedOverride = opts?.seedOverride;
  }

  /**
   * Load an existing shard world blueprint from storage, or
   * generate + persist a new one if it does not exist (or is missing).
   */
  async loadOrGenerate(): Promise<WorldBlueprint> {
    const exists = await this.storage.shardExists(this.shardId);

    if (!exists) {
      log.warn("Shard does not exist, generating new world", {
        shardId: this.shardId,
        name: this.name,
      });

      const seed = this.seedOverride ?? this.computeSeedFromId(this.shardId);
      const blueprint = await this.generateWorld({
        shardId: this.shardId,
        name: this.name,
        seed,
      });

      await this.storage.saveWorldBlueprint(this.shardId, blueprint);

      log.success("New shard world generated and saved", {
        shardId: this.shardId,
        name: this.name,
        seed,
      });

      return blueprint;
    }

    // Try to load existing blueprint
    const loaded = await this.storage.loadWorldBlueprint(this.shardId);

    if (!loaded) {
      log.warn("Shard exists but has no blueprint, regenerating", {
        shardId: this.shardId,
        name: this.name,
      });

      const seed = this.seedOverride ?? this.computeSeedFromId(this.shardId);
      const regen = await this.generateWorld({
        shardId: this.shardId,
        name: this.name,
        seed,
      });

      await this.storage.saveWorldBlueprint(this.shardId, regen);

      log.success("Regenerated shard world and saved", {
        shardId: this.shardId,
        name: this.name,
        seed,
      });

      return regen;
    }

    log.success("Loaded shard world from storage", {
      shardId: this.shardId,
      name: loaded.name,
    });

    return loaded;
  }

  /**
   * Simple deterministic hash from shardId -> 32-bit unsigned seed.
   * Matches the spirit of the old fossil implementation.
   */
  private computeSeedFromId(id: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
}
