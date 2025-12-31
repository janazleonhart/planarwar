// worldcore/sim/SimWorld.ts
// In-memory world state for the brain harness.
// DB-free so tests are fast + deterministic.

import type { ShardId, WorldPos } from "./SimGrid";

export type SimSpawnPoint = {
  shardId: ShardId;
  spawnId: string;
  type: string;

  // kept because your DB schema has them
  protoId: string;
  variantId: string | null;
  archetype: string;

  x: number;
  y: number;
  z: number;

  regionId: string | null;

  // Brain-only metadata (NOT persisted yet)
  meta?: Record<string, unknown>;
};

export class SimWorld {
  private spawns = new Map<string, SimSpawnPoint>();

  upsertSpawn(spawn: SimSpawnPoint): void {
    this.spawns.set(spawn.spawnId, { ...spawn });
  }

  getSpawn(spawnId: string): SimSpawnPoint | undefined {
    const s = this.spawns.get(spawnId);
    return s ? { ...s } : undefined;
  }

  listSpawns(): SimSpawnPoint[] {
    return [...this.spawns.values()].map((s) => ({ ...s }));
  }

  listSpawnsByType(type: string): SimSpawnPoint[] {
    return this.listSpawns().filter((s) => s.type === type);
  }

  listSpawnsNear(x: number, z: number, radius: number): SimSpawnPoint[] {
    const r = Math.max(0, radius);
    const r2 = r * r;
    const out: SimSpawnPoint[] = [];
    for (const s of this.spawns.values()) {
      const dx = s.x - x;
      const dz = s.z - z;
      if (dx * dx + dz * dz <= r2) out.push({ ...s });
    }
    return out;
  }

  static dist2(a: WorldPos, b: WorldPos): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return dx * dx + dz * dz;
  }
}
