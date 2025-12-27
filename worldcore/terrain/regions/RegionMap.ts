//worldcore/terrain/regions/RegionMap.ts

import { Logger } from "../../utils/logger";
import { Heightmap } from "../height/Heightmap";
import { Region, RegionId, RegionSample } from "./RegionTypes";

const log = Logger.scope("REGIONMAP");

/**
 * Internal cache entry for a single region cell.
 * We keep both the coarse Region and the fine terrain numbers.
 */
interface RegionCell {
  id: RegionId;
  cx: number;
  cz: number;
  x: number;
  z: number;
  biome: string;
  height: number;
  slope: number;
  region: Region;
}

export interface RegionMapOptions {
  worldId: string;
  seed: number;
  worldRadius: number;
  /**
   * Size of a region cell in world units.
   * Bigger cell = fewer regions, more "macro" map.
   */
  cellSize?: number;
}

/**
 * RegionMap v3 (worldcore)
 *
 * - Stateless input: Heightmap, worldRadius, seed.
 * - Lazy generation: only creates cells when asked for coordinates.
 * - LRU cache so we don't blow memory in large worlds.
 * - Returns canonical Region objects that strategy / MMO / city-builder
 *   can all share.
 */
export class RegionMap {
  private readonly worldId: string;
  private readonly seed: number;
  private readonly worldRadius: number;
  public readonly cellSize: number;

  private cache = new Map<string, RegionCell>();
  private cacheOrder: string[] = [];

  constructor(private readonly heightmap: Heightmap, opts: RegionMapOptions) {
    this.worldId = opts.worldId;
    this.seed = opts.seed;
    this.worldRadius = opts.worldRadius;
    this.cellSize = opts.cellSize ?? 64;
  }

  /**
   * Internal: ensures cache does not grow indefinitely.
   * 10,000 region cells ≈ a few MB.
   */
  private enforceCacheLimit() {
    const MAX = 10000;
    if (this.cacheOrder.length > MAX) {
      const oldest = this.cacheOrder.shift();
      if (oldest) this.cache.delete(oldest);
    }
  }

  private key(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  /**
   * Compute a region cell on demand.
   */
  private computeCell(cx: number, cz: number): RegionCell {
    const wx = cx * this.cellSize + this.cellSize * 0.5;
    const wz = cz * this.cellSize + this.cellSize * 0.5;

    const h = this.heightmap.sample(wx, wz);
    const s = this.heightmap.sampleSlope(wx, wz);

    const biome = this.classifyBiome(wx, wz, h, s);

    const id: RegionId = `${this.worldId}:${cx},${cz}`;
    const radius = this.cellSize * 0.75;

    const region: Region = {
      id,
      worldId: this.worldId,
      seed: this.seed,
      centerX: wx,
      centerZ: wz,
      radius,
      biome,
      avgHeight: h,
      avgSlope: s,
      resourceDensity: undefined,
      climateZone: undefined,
      tags: [],
      generatedAt: Date.now(),
    };

    return {
      id,
      cx,
      cz,
      x: wx,
      z: wz,
      biome,
      height: h,
      slope: s,
      region,
    };
  }

  /**
   * Lazy-loaded region access with caching.
   */
  private getOrCreate(cx: number, cz: number): RegionCell {
    const key = this.key(cx, cz);
    let cell = this.cache.get(key);

    if (!cell) {
      cell = this.computeCell(cx, cz);
      this.cache.set(key, cell);
      this.cacheOrder.push(key);
      this.enforceCacheLimit();
    }

    return cell;
  }

  /**
   * Clamp to world bounds.
   */
  private isInsideWorld(x: number, z: number): boolean {
    return (
      Math.abs(x) <= this.worldRadius &&
      Math.abs(z) <= this.worldRadius
    );
  }

  /**
   * Returns the Region containing world coordinate (x, z),
   * or undefined if outside the simulated disk.
   */
  getRegionAt(x: number, z: number): Region | undefined {
    if (!this.isInsideWorld(x, z)) return undefined;

    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);

    return this.getOrCreate(cx, cz).region;
  }

  /**
   * Fast biome lookup for AI / mission generation / UI tinting.
   */
  getBiomeAt(x: number, z: number): string {
    return this.getRegionAt(x, z)?.biome ?? "default";
  }

  /**
   * Grab a fine-grained sample at this point.
   */
  sampleAt(x: number, z: number): RegionSample | undefined {
    const region = this.getRegionAt(x, z);
    if (!region) return undefined;

    const height = this.heightmap.sample(x, z, region.biome);
    const slope = this.heightmap.sampleSlope(x, z, region.biome);

    return {
      x,
      z,
      height,
      slope,
      biome: region.biome,
    };
  }

  /**
   * Coarse overview grid for blueprints / warfront UI:
   * Samples the world into roughly OVERVIEW x OVERVIEW regions.
   */
  toOverviewGrid(overviewSize: number = 64): Region[] {
    const size = overviewSize;
    const diameter = this.worldRadius * 2;
    const step = Math.max(1, Math.floor(diameter / size));

    const regions: Region[] = [];

    for (let x = -this.worldRadius; x < this.worldRadius; x += step) {
      for (let z = -this.worldRadius; z < this.worldRadius; z += step) {
        const region = this.getRegionAt(x, z);
        if (!region) continue;

        // We might hit the same cell multiple times; dedupe by id.
        if (!regions.find((r) => r.id === region.id)) {
          regions.push(region);
        }
      }
    }

    log.debug?.(
      `Overview grid generated: ${regions.length} regions (size=${size}, step=${step})`
    );

    return regions;
  }

  /**
   * Terrain → biome classification.
   * Super simple rules for now; we can later delegate to BiomeRules.
   */
  private classifyBiome(
    x: number,
    z: number,
    height: number,
    slope: number
  ): string {
    // Flat band roads every ~200 units
    if (slope < 0.1 && Math.abs(Math.floor(x)) % 200 < 4) return "road";

    // Low, relatively flat → riverbeds
    if (height < -2 && slope < 0.4) return "river";

    // Very steep → hills / cliffs
    if (slope > 1.4) return "hills";

    // Higher ground → forested
    if (height > 16) return "forest";

    // Very flat & low → plains
    if (height < 2 && slope < 0.2) return "plains";

    // Gentle mid-height → farmland belt
    if (height > 2 && height < 8 && slope < 0.3) return "farm";

    // Default fallback
    return "forest";
  }
}