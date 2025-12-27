//worldcore/terrain/worldgen/WGEv2Biomes.ts

/**
 * PLANAR WAR – WORLD GENERATION ENGINE V2
 * Stage 2.3.4 — Biome Assignment (Production Edition)
 *
 * Inputs:
 *  - LandformResult
 *  - ErosionResult
 *  - ClimateResult
 *
 * Outputs:
 *  - BiomeResult:
 *      • biomeId per cell
 *      • biome clusters (connected components)
 *      • biome metadata
 *
 * Biomes are classified from:
 *  - elevation (sea, coast, hill, plateau, mountains)
 *  - moisture
 *  - temperature
 *  - climate zone
 *  - tectonics (uplift = volcanic potential)
 *  - rivers + lakes
 */

 import {
    LandformResult,
    WorldGenStage,
    WorldGenContext,
    WorldGenError
  } from "./WGEv2Landforms";
  
  import { ErosionResult } from "./WGEv2Erosion";
  import { ClimateResult, ClimateZoneCode } from "./WGEv2Climate";

  const BIOME_SALT = 0xc2b2ae35;
  
  /**
   * Biome IDs (uint16 range so we can go wild later)
   *
   * 0 = Ocean
   * 1 = Coast
   * 2 = Beach
   * 3 = River
   * 4 = Lake
   * 5 = Wetlands
   * 6 = Grassland
   * 7 = Forest
   * 8 = Boreal Forest
   * 9 = Jungle
   * 10 = Desert
   * 11 = Savanna
   * 12 = Snow
   * 13 = Alpine
   * 14 = Volcanic Plain
   * 15 = Lava Field
   * 16 = Basalt Plateau
   * 17 = Magma Lake
   */
  export enum BiomeId {
    Ocean = 0,
    Coast = 1,
    Beach = 2,
    River = 3,
    Lake = 4,
    Wetlands = 5,
    Grassland = 6,
    Forest = 7,
    BorealForest = 8,
    Jungle = 9,
    Desert = 10,
    Savanna = 11,
    Snow = 12,
    Alpine = 13,
    VolcanicPlain = 14,
    LavaField = 15,
    BasaltPlateau = 16,
    MagmaLake = 17
  }
  
  export interface BiomeParams {
    coastThreshold: number;       
    beachThreshold: number;       
    hillThreshold: number;        
    mountainThreshold: number;    
    volcanicUpliftThreshold: number;
    magmaLakeChance: number;      
  }
  
  export interface BiomeInput {
    landforms: LandformResult;
    erosion: ErosionResult;
    climate: ClimateResult;
    params?: Partial<BiomeParams>;
  }
  
  export interface BiomeResult {
    width: number;
    height: number;
  
    biomeMap: Uint16Array;     // BiomeId per cell
    clusters: Uint16Array;     // Connected biome region ID per cell
    biomeCounts: Map<BiomeId, number>;
  }
  
  const DEFAULT_PARAMS: BiomeParams = {
    coastThreshold: 0.05,
    beachThreshold: 0.1,
    hillThreshold: 0.35,
    mountainThreshold: 0.65,
    volcanicUpliftThreshold: 0.55,
    magmaLakeChance: 0.02
  };
  
  export class WGEv2BiomesStage
  implements WorldGenStage<BiomeInput, BiomeResult>
{
  public readonly name = "WGEv2Biomes";

  run(
    input: BiomeInput,
    context?: WorldGenContext
  ): BiomeResult {
      const logger = context?.logger;
  
      const land = input.landforms;
      const erosion = input.erosion;
      const climate = input.climate;
  
      const width = land.width;
      const height = land.height;
  
      if (width <= 0 || height <= 0)
        throw new WorldGenError(`[${this.name}] Invalid dimensions.`);
  
      const params: BiomeParams = {
        ...DEFAULT_PARAMS,
        ...(input.params ?? {})
      };
  
      const biomeMap = new Uint16Array(width * height);
  
      logger?.info?.(
        `[${this.name}] Assigning biomes…`,
        { width, height }
      );
  
      const seaLevel = land.metadata.seaLevel;
  
      // -------------------------------------------------------
      // MAIN BIOME CLASSIFICATION
      // -------------------------------------------------------
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
  
          const elev = land.elevation[idx];
          const moist = climate.moisture[idx];
          const temp = climate.temperature[idx];
          const zone = climate.zones[idx];
          const uplift = land.tectonics.uplift[idx];
  
          const isRiver = erosion.rivers[idx] > 0;
          const isLake = erosion.lakes[idx] > 0;
  
          // --------------------------
          // WATER FIRST
          // --------------------------
          if (elev < seaLevel) {
            biomeMap[idx] = BiomeId.Ocean;
            continue;
          }
  
          if (isLake) {
            // Rare chance some lakes become magma lakes if tectonics are intense
            if (uplift > params.volcanicUpliftThreshold &&
                Math.random() < params.magmaLakeChance) {
              biomeMap[idx] = BiomeId.MagmaLake;
            } else {
              biomeMap[idx] = BiomeId.Lake;
            }
            continue;
          }
  
          if (isRiver) {
            biomeMap[idx] = BiomeId.River;
            continue;
          }
  
          // --------------------------
          // COAST / BEACH LOGIC
          // --------------------------
          const distBelow = elev - seaLevel;
  
          if (distBelow < params.coastThreshold) {
            biomeMap[idx] = BiomeId.Coast;
            continue;
          }
          if (distBelow < params.beachThreshold) {
            biomeMap[idx] = BiomeId.Beach;
            continue;
          }
  
          // --------------------------
          // VOLCANIC REGIONS
          // --------------------------
          if (uplift > params.volcanicUpliftThreshold) {
            // High uplift → volcanic area
            if (uplift > params.volcanicUpliftThreshold * 1.3) {
              // HOT fissures → lava fields
              biomeMap[idx] = BiomeId.LavaField;
            } else {
              // Basalt plains / volcanic tundra
              biomeMap[idx] = BiomeId.VolcanicPlain;
            }
            continue;
          }
  
          // --------------------------
          // TERRESTRIAL REGIONS
          // --------------------------
          const absElev = elev;
  
          // Alpine if high & cold
          if (absElev > params.mountainThreshold && temp < 5) {
            biomeMap[idx] = BiomeId.Alpine;
            continue;
          }
  
          // Snow / tundra
          if (temp <= -5) {
            biomeMap[idx] = BiomeId.Snow;
            continue;
          }
  
          // Desert (dry + warm)
          if (moist < 0.18 && temp > 18) {
            biomeMap[idx] = BiomeId.Desert;
            continue;
          }
  
          // Savanna (warm + moderately dry)
          if (moist < 0.35 && temp > 16) {
            biomeMap[idx] = BiomeId.Savanna;
            continue;
          }
  
          // Boreal forest (cold temperate)
          if (zone <= 2) {
            biomeMap[idx] = BiomeId.BorealForest;
            continue;
          }
  
          // Jungle (hot + humid)
          if (temp > 22 && moist > 0.6) {
            biomeMap[idx] = BiomeId.Jungle;
            continue;
          }
  
          // Wetlands
          if (moist > 0.75) {
            biomeMap[idx] = BiomeId.Wetlands;
            continue;
          }
  
          // Forest
          if (moist > 0.45) {
            biomeMap[idx] = BiomeId.Forest;
            continue;
          }
  
          // Grassland
          biomeMap[idx] = BiomeId.Grassland;
        }
      }
  
      // -------------------------------------------------------
      // BIOME CLUSTERING (flood fill for region generation)
      // -------------------------------------------------------
      logger?.info?.(`[${this.name}] Building biome clusters…`);
  
      const clusters = new Uint16Array(width * height);
      clusters.fill(0xFFFF);
  
      let clusterId = 0;
  
      const flood = (sx: number, sy: number, id: number, biome: BiomeId) => {
        const stack = [[sx, sy]];
        clusters[sy * width + sx] = id;
  
        while (stack.length > 0) {
          const [x, y] = stack.pop()!;
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
  
            const nIdx = ny * width + nx;
            if (clusters[nIdx] !== 0xFFFF) continue;
            if (biomeMap[nIdx] !== biome) continue;
  
            clusters[nIdx] = id;
            stack.push([nx, ny]);
          }
        }
      };
  
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
  
          if (clusters[idx] !== 0xFFFF) continue;
  
          const biome = biomeMap[idx] as BiomeId;
          flood(x, y, clusterId, biome);
          clusterId++;
        }
      }
  
      // -------------------------------------------------------
      // BIOME COUNTING
      // -------------------------------------------------------
      const biomeCounts = new Map<BiomeId, number>();
      for (let i = 0; i < biomeMap.length; i++) {
        const b = biomeMap[i] as BiomeId;
        biomeCounts.set(b, (biomeCounts.get(b) ?? 0) + 1);
      }
  
      logger?.success?.(
        `[${this.name}] Biome stage complete: clusters=${clusterId}, distinctBiomes=${biomeCounts.size}`
      );
  
      return {
        width,
        height,
        biomeMap,
        clusters,
        biomeCounts
      };
    }
  }
  