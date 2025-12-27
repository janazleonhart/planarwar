//worldcore/terrain/worldgen/WGEv2Climate.ts

/**
 * PLANAR WAR – WORLD GENERATION ENGINE V2
 * Stage 2.3.3 — Climate Simulation (Production Edition)
 *
 * Responsibilities:
 *  - Compute temperature field from latitude + elevation.
 *  - Compute moisture from latitude + proximity to water + noise.
 *  - Classify each cell into a compact climate zone code.
 *
 * Inputs:
 *  - LandformResult (required)
 *  - ErosionResult (optional but recommended for rivers/lakes)
 *
 * Outputs:
 *  - ClimateResult containing:
 *      - temperature (Float32Array)
 *      - moisture (Float32Array)
 *      - climateZones (Uint8Array)
 *
 * This module is written to be compatible with:
 *  - Node backend (worldgen server)
 *  - Client/shared reference code
 */

 import {
    LandformResult,
    WorldGenStage,
    WorldGenContext,
    ILogger,
    WorldGenError,
    createRng
  } from "./WGEv2Landforms";
  import { ErosionResult } from "./WGEv2Erosion";

  const CLIMATE_SALT = 0x27d4eb2f;
  
  /**
   * High-level climate parameters. All values are abstract "game units",
   * not real-world °C or mm rainfall, but behave similarly.
   */
  export interface ClimateParams {
    equatorTemperature: number;    // Base temp at equator at sea level
    poleTemperature: number;       // Base temp at poles at sea level
    lapseRate: number;             // Temperature drop per unit elevation
    humidityBase: number;          // Base humidity factor
    humidityLatitudeFactor: number;// Weight of latitude in humidity
    humidityNoiseFactor: number;   // Amount of random variation
    coastalBonus: number;          // Moisture bonus near water
    inlandPenalty: number;         // Moisture penalty far inland
    riverMoistureBoost: number;    // Moisture boost along rivers
    lakeMoistureBoost: number;     // Moisture boost in lakes
  }
  
  /**
   * Input to the climate stage.
   */
  export interface ClimateInput {
    landforms: LandformResult;
    erosion?: ErosionResult;
    shardSeed: number;             // For climate noise RNG
    params?: Partial<ClimateParams>;
  }
  
  /**
   * Compact climate zone classification.
   *
   * 0 = Polar / Ice
   * 1 = Subpolar / Tundra
   * 2 = Cold Temperate (boreal/taiga)
   * 3 = Temperate (mixed forest / grass)
   * 4 = Warm Temperate / Mediterranean
   * 5 = Subtropical humid
   * 6 = Tropical rainforest
   * 7 = Arid (hot desert)
   * 8 = Semi-arid (steppe)
   */
  export type ClimateZoneCode =
    | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  
  export interface ClimateResult {
    width: number;
    height: number;
  
    temperature: Float32Array; // Arbitrary units, higher = warmer
    moisture: Float32Array;    // [0, 1] range
    zones: Uint8Array;         // ClimateZoneCode
  }
  
  const DEFAULT_CLIMATE_PARAMS: ClimateParams = {
    equatorTemperature: 28,
    poleTemperature: -8,
    lapseRate: 12,
    humidityBase: 0.55,
    humidityLatitudeFactor: 0.25,
    humidityNoiseFactor: 0.15,
    coastalBonus: 0.25,
    inlandPenalty: -0.2,
    riverMoistureBoost: 0.2,
    lakeMoistureBoost: 0.3
  };
  
  /**
   * Simple 2D noise used for climate variability.
   */
  class ClimateNoise {
    private grid: Float32Array;
    private size: number;
  
    constructor(seed: number, size = 256) {
      this.size = size;
      this.grid = new Float32Array(size * size);
      const rng = createRng(seed);
      for (let i = 0; i < this.grid.length; i++) {
        this.grid[i] = rng() * 2 - 1; // [-1,1]
      }
    }
  
    private sampleGrid(ix: number, iy: number): number {
      const x = ((ix % this.size) + this.size) % this.size;
      const y = ((iy % this.size) + this.size) % this.size;
      return this.grid[y * this.size + x];
    }
  
    sample(x: number, y: number, frequency = 1.0): number {
      const fx = x * frequency;
      const fy = y * frequency;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      const tx = fx - x0;
      const ty = fy - y0;
  
      const v00 = this.sampleGrid(x0, y0);
      const v10 = this.sampleGrid(x1, y0);
      const v01 = this.sampleGrid(x0, y1);
      const v11 = this.sampleGrid(x1, y1);
  
      const ix0 = lerp(v00, v10, smoothstep(tx));
      const ix1 = lerp(v01, v11, smoothstep(tx));
  
      return lerp(ix0, ix1, smoothstep(ty)); // [-1,1]
    }
  }
  
  function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }
  
  function smoothstep(t: number): number {
    return t * t * (3 - 2 * t);
  }
  
  /**
   * Main climate stage implementation.
   */
   export class WGEv2ClimateStage
   implements WorldGenStage<ClimateInput, ClimateResult>
 {
   public readonly name = "WGEv2Climate";
 
   run(
     input: ClimateInput,
     context?: WorldGenContext
   ): ClimateResult {
      const logger = context?.logger;
      const land = input.landforms;
  
      const width = land.width;
      const height = land.height;
      if (width <= 0 || height <= 0) {
        throw new WorldGenError(
          `[${this.name}] Invalid dimensions width=${width}, height=${height}`
        );
      }
  
      const params: ClimateParams = {
        ...DEFAULT_CLIMATE_PARAMS,
        ...(input.params ?? {})
      };
  
      const erosion = input.erosion;
      const seed = input.shardSeed >>> 0;
  
      logger?.info?.(
        `[${this.name}] Starting climate simulation…`,
        { width, height, seed }
      );
  
      const temperature = new Float32Array(width * height);
      const moisture = new Float32Array(width * height);
      const zones = new Uint8Array(width * height);
  
      const noise = new ClimateNoise(seed ^ 0xC1E1C1E1);
  
      // Precompute: approximate "distance to nearest water" map.
      // This is a cheap approximation: N passes of local checks.
      const waterDistance = this.computeWaterDistance(width, height, land, erosion);
  
      // ----------------------------------------------------------
      // 1. Temperature: latitude + altitude model
      // ----------------------------------------------------------
      for (let y = 0; y < height; y++) {
        // Map y ∈ [0, height-1] to latitude ∈ [-1, 1]
        const latNorm = (y / (height - 1)) * 2 - 1; // -1 = south pole, 0 = equator, 1 = north pole
        const latAbs = Math.abs(latNorm);
  
        // Linear interpolation between equator and pole temperatures
        const baseTemp = lerp(
          params.equatorTemperature,
          params.poleTemperature,
          latAbs
        );
  
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          const elev = land.elevation[idx]; // [-1,1]
  
          // Normalize elevation: sea = 0, mountains ~1, trenches ~-1
          const heightFactor = Math.max(0, elev); // only above sea level cools
          const lapse = heightFactor * params.lapseRate;
  
          const resultTemp = baseTemp - lapse;
          temperature[idx] = resultTemp;
        }
      }
  
      // ----------------------------------------------------------
      // 2. Moisture: latitude + water proximity + noise
      // ----------------------------------------------------------
      for (let y = 0; y < height; y++) {
        const latNorm = (y / (height - 1)) * 2 - 1;
        const latAbs = Math.abs(latNorm);
  
        // At equator: high humidity; near poles: lower humidity
        const latHumidity = (1 - latAbs);
  
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
  
          const distToWater = waterDistance[idx]; // approx distance in cells
  
          // Basic humidity = base + latitude component
          let h =
            params.humidityBase +
            params.humidityLatitudeFactor * latHumidity;
  
          // Inland effect (far from water → drier)
          const inlandFactor = Math.min(1, distToWater / 32); // 0..1
          h += lerp(params.coastalBonus, params.inlandPenalty, inlandFactor);
  
          // Rivers & lakes from erosion result
          if (erosion) {
            if (erosion.rivers[idx] > 0) {
              h += params.riverMoistureBoost;
            }
            if (erosion.lakes[idx] > 0) {
              h += params.lakeMoistureBoost;
            }
          }
  
          // Noise variation
          const n = noise.sample(x / width, y / height, 3.0); // [-1,1]
          h += n * params.humidityNoiseFactor;
  
          // Clamp to [0,1]
          moisture[idx] = Math.max(0, Math.min(1, h));
        }
      }
  
      // ----------------------------------------------------------
      // 3. Climate zone classification
      // ----------------------------------------------------------
      for (let i = 0; i < zones.length; i++) {
        zones[i] = classifyClimate(temperature[i], moisture[i]);
      }
  
      logger?.info?.(
        `[${this.name}] Climate simulation complete.`
      );
  
      return {
        width,
        height,
        temperature,
        moisture,
        zones
      };
    }
  
    /**
     * Approximate distance to nearest water (sea, lake, or river).
     * We use:
     *  - seaLevel from landforms (elev < seaLevel → water)
     *  - erosion.rivers and erosion.lakes if present.
     *
     * Distance is measured in grid steps and capped.
     */
    private computeWaterDistance(
      width: number,
      height: number,
      land: LandformResult,
      erosion?: ErosionResult
    ): Float32Array {
      const maxDist = 64; // cap
      const dist = new Float32Array(width * height);
      const seaLevel = land.metadata.seaLevel;
  
      // Initialize distances
      for (let i = 0; i < dist.length; i++) {
        dist[i] = maxDist;
      }
  
      const queueX = new Int16Array(width * height);
      const queueY = new Int16Array(width * height);
      let qHead = 0;
      let qTail = 0;
  
      const enqueue = (x: number, y: number, d: number) => {
        const idx = y * width + x;
        if (d < dist[idx]) {
          dist[idx] = d as number;
          queueX[qTail] = x;
          queueY[qTail] = y;
          qTail++;
        }
      };
  
      // Seed queue with all water cells
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          const elev = land.elevation[idx];
  
          const isSea = elev < seaLevel;
          const isRiver = erosion ? erosion.rivers[idx] > 0 : false;
          const isLake = erosion ? erosion.lakes[idx] > 0 : false;
  
          if (isSea || isRiver || isLake) {
            enqueue(x, y, 0);
          }
        }
      }
  
      // BFS expand distances
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ] as const;
  
      while (qHead < qTail) {
        const x = queueX[qHead];
        const y = queueY[qHead];
        const baseIdx = y * width + x;
        const baseDist = dist[baseIdx];
        qHead++;
  
        if (baseDist >= maxDist) continue;
  
        for (const [dx, dy] of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
  
          const nIdx = ny * width + nx;
          const nd = baseDist + 1;
  
          if (nd < dist[nIdx]) {
            dist[nIdx] = nd;
            queueX[qTail] = nx;
            queueY[qTail] = ny;
            qTail++;
          }
        }
      }
  
      return dist;
    }
  }
  
  /**
   * Classify climate zone based on temperature and moisture.
   * Temperature is in abstract units (e.g., -10..30+).
   * Moisture is in [0,1].
   */
  function classifyClimate(temp: number, moist: number): ClimateZoneCode {
    // Polar/ice
    if (temp <= -5) {
      return moist < 0.4 ? 0 : 1;
    }
  
    // Cold temperate / boreal
    if (temp > -5 && temp <= 5) {
      if (moist < 0.25) return 8;   // cold steppe
      return 2;
    }
  
    // Cool to mild temperate
    if (temp > 5 && temp <= 15) {
      if (moist < 0.2) return 8;    // steppe
      if (moist < 0.45) return 3;   // temperate grassland
      return 3;                     // mixed forest
    }
  
    // Warm temperate / Mediterranean / subtropical edges
    if (temp > 15 && temp <= 22) {
      if (moist < 0.18) return 7;   // hot desert-like
      if (moist < 0.35) return 8;   // semi-arid
      if (moist < 0.6) return 4;    // warm temperate / Mediterranean
      return 5;                     // humid subtropical
    }
  
    // Tropical
    if (temp > 22) {
      if (moist < 0.15) return 7;   // desert
      if (moist < 0.35) return 8;   // semi-arid
      if (moist < 0.65) return 5;   // humid
      return 6;                     // rainforest
    }
  
    // Fallback – shouldn’t normally hit
    return 3;
  }
  