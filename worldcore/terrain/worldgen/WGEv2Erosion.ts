//worldcore/terrain/worldgen/WGEv2Erosion.ts

/**
 * PLANAR WAR – WORLD GENERATION ENGINE V2
 * Stage 2.3.2 — Hydrology, Erosion, Rivers, Lake Basins (Production Edition)
 *
 * This module takes the output of WGEv2LandformsStage and applies:
 *   - Downhill flow accumulation
 *   - River path detection
 *   - Hydraulic erosion (fast approximation)
 *   - Sediment transport & deposition
 *   - Lake identification and filling
 *   - Water mask and flow direction map
 *
 * Output:
 *   - Updated elevation field
 *   - Water maps (river/lake)
 *   - Flow map (directions)
 *
 * Fully deterministic. Optimized for 512–2048 resolutions.
 */

 import {
    LandformResult,
    WorldGenStage,
    WorldGenContext,
    ILogger,
    WorldGenError
  } from "./WGEv2Landforms";
  
  export interface ErosionParams {
    iterations: number;            // Number of erosion passes
    rainAmount: number;            // How much water is added per iteration
    evaporateRate: number;         // Water loss per iteration
    sedimentCapacity: number;      // How much sediment water can carry
    minSlope: number;              // Minimum slope needed to transport sediment
    lakeFillIterations: number;    // How many passes to fill lakes
    riverThreshold: number;        // Flow accumulation needed to mark a river
  }
  
  export interface ErosionInput {
    landforms: LandformResult;
    params?: Partial<ErosionParams>;
  }
  
  export interface ErosionResult {
    width: number;
    height: number;
  
    elevation: Float32Array;       // Modified terrain
    water: Float32Array;           // Water accumulation field
    sediment: Float32Array;        // Sediment content
    flowDir: Int8Array;            // 0–7 cardinal directions
    flowAccum: Float32Array;       // Flow accumulation
    rivers: Uint8Array;            // 0/1 mask for rivers
    lakes: Uint8Array;             // 0/1 mask for lakes
  }
  
  const DEFAULT_EROSION_PARAMS: ErosionParams = {
    iterations: 45,
    rainAmount: 0.01,
    evaporateRate: 0.015,
    sedimentCapacity: 0.05,
    minSlope: 0.0005,
    lakeFillIterations: 8,
    riverThreshold: 8.0
  };
  
  /**
   * Flow direction mapping:
   *
   *  3 2 1
   *  4 X 0
   *  5 6 7
   *
   * Directions 0–7 correspond to dx/dy offsets:
   */
  const DIR_X = [1, 1, 0, -1, -1, -1, 0, 1];
  const DIR_Y = [0, -1, -1, -1, 0, 1, 1, 1];
  
  /**
   * Helper to compute index.
   */
  function idxOf(x: number, y: number, width: number): number {
    return y * width + x;
  }
  
  export class WGEv2ErosionStage
  implements WorldGenStage<ErosionInput, ErosionResult>
  {
    public readonly name = "WGEv2Erosion";

    run(
    input: ErosionInput,
    context?: WorldGenContext
    ): ErosionResult  {
  
      const logger = context?.logger;
      const land = input.landforms;
  
      const width = land.width;
      const height = land.height;
  
      const params: ErosionParams = {
        ...DEFAULT_EROSION_PARAMS,
        ...(input.params ?? {})
      };
  
      logger?.info(`[WGEv2] Running Erosion Stage…`, params);
  
      const elevation = land.elevation.slice(); // Clone
      const water = new Float32Array(width * height);
      const sediment = new Float32Array(width * height);
      const flowDir = new Int8Array(width * height);      // direction index 0–7
      const flowAccum = new Float32Array(width * height);
      const rivers = new Uint8Array(width * height);
      const lakes = new Uint8Array(width * height);
  
      // -------------------------------------------------------------
      // 1. Compute flow direction per cell (steepest descent)
      // -------------------------------------------------------------
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let idx = idxOf(x, y, width);
  
          let bestDir = -1;
          let bestDrop = 0;
  
          const h = elevation[idx];
  
          for (let d = 0; d < 8; d++) {
            const nx = x + DIR_X[d];
            const ny = y + DIR_Y[d];
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
  
            const nIdx = idxOf(nx, ny, width);
            const drop = h - elevation[nIdx];
  
            if (drop > bestDrop) {
              bestDrop = drop;
              bestDir = d;
            }
          }
  
          // If no downhill, flowDir = -1 (potential lake/PIT)
          flowDir[idx] = bestDir;
        }
      }
  
      // -------------------------------------------------------------
      // 2. Flow accumulation — multiple passes until convergence
      // -------------------------------------------------------------
      logger?.info(`[WGEv2] Computing flow accumulation…`);
  
      // Initialize all flow accumulation to 1 (each cell contributes)
      for (let i = 0; i < flowAccum.length; i++) {
        flowAccum[i] = 1;
      }
  
      let changed = true;
      let passes = 0;
  
      while (changed && passes < 25) {
        changed = false;
        passes++;
  
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = idxOf(x, y, width);
            const d = flowDir[idx];
            if (d < 0) continue;
  
            const nx = x + DIR_X[d];
            const ny = y + DIR_Y[d];
            const nIdx = idxOf(nx, ny, width);
  
            const old = flowAccum[nIdx];
            const added = flowAccum[idx];
  
            const nextVal = old + added;
            if (nextVal !== old) {
              flowAccum[nIdx] = nextVal;
              changed = true;
            }
          }
        }
      }
  
      logger?.info(`[WGEv2] Flow accumulation passes=${passes}`);
  
      // -------------------------------------------------------------
      // 3. Identify potential lakes (pits where no downhill exists)
      // -------------------------------------------------------------
      logger?.info(`[WGEv2] Detecting lake basins…`);
  
      for (let i = 0; i < flowDir.length; i++) {
        if (flowDir[i] < 0) {
          lakes[i] = 1;
        }
      }
  
      // -------------------------------------------------------------
      // 4. Lake filling — raise pit elevations slowly until drainage exists
      // -------------------------------------------------------------
      for (let iter = 0; iter < params.lakeFillIterations; iter++) {
        let adjusted = false;
  
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = idxOf(x, y, width);
  
            if (lakes[idx] === 0) continue;
  
            const h = elevation[idx];
            let lowestNeighbor = Infinity;
  
            for (let d = 0; d < 8; d++) {
              const nx = x + DIR_X[d];
              const ny = y + DIR_Y[d];
              if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
  
              const nIdx = idxOf(nx, ny, width);
              lowestNeighbor = Math.min(lowestNeighbor, elevation[nIdx]);
            }
  
            if (lowestNeighbor < Infinity && h < lowestNeighbor) {
              elevation[idx] += (lowestNeighbor - h) * 0.45;
              adjusted = true;
            }
          }
        }
  
        if (!adjusted) break;
      }
  
      // -------------------------------------------------------------
      // 5. Hydraulic erosion simulation (simplified)
      // -------------------------------------------------------------
      logger?.info(`[WGEv2] Running hydraulic erosion passes (${params.iterations})…`);
  
      for (let iter = 0; iter < params.iterations; iter++) {
        // Rainfall
        for (let i = 0; i < water.length; i++) {
          water[i] += params.rainAmount;
        }
  
        // For each cell, move water downhill, remove sediment, deposit where flat
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = idxOf(x, y, width);
            const dir = flowDir[idx];
            if (dir < 0) continue;
  
            const nx = x + DIR_X[dir];
            const ny = y + DIR_Y[dir];
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
  
            const nIdx = idxOf(nx, ny, width);
  
            const h = elevation[idx];
            const h2 = elevation[nIdx];
            const slope = h - h2;
  
            // Water transfer
            const transferred = water[idx] * 0.6;
            water[idx] -= transferred;
            water[nIdx] += transferred;
  
            // Erosion logic
            if (slope > params.minSlope) {
              // Water can carry sediment
              const capacity = slope * params.sedimentCapacity;
  
              if (sediment[idx] < capacity) {
                const take = Math.min(capacity - sediment[idx], elevation[idx] * 0.002);
                sediment[idx] += take;
                elevation[idx] -= take;
              }
            } else {
              // Deposit sediment
              const deposit = sediment[idx] * 0.4;
              sediment[idx] -= deposit;
              elevation[idx] += deposit;
            }
          }
        }
  
        // Evaporation
        for (let i = 0; i < water.length; i++) {
          water[i] = Math.max(0, water[i] - params.evaporateRate);
        }
      }
  
      // -------------------------------------------------------------
      // 6. Mark rivers by flow accumulation threshold
      // -------------------------------------------------------------
      const threshold = params.riverThreshold;
      for (let i = 0; i < rivers.length; i++) {
        rivers[i] = flowAccum[i] > threshold ? 1 : 0;
      }
  
      // Lake mask refinement:
      for (let i = 0; i < lakes.length; i++) {
        if (water[i] < 0.005) lakes[i] = 0;
      }
  
      logger?.success?.(`[WGEv2] Erosion Stage complete.`);
  
      return {
        width,
        height,
        elevation,
        water,
        sediment,
        flowDir,
        flowAccum,
        rivers,
        lakes
      };
    }
  }
  