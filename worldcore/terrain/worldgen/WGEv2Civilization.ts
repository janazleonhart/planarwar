//worldcore/terrain/worldgen/WGEv2Civilization.ts

import {
    LandformResult,
    WorldGenStage,
    WorldGenContext,
    WorldGenError,
    createRng,
  } from "./WGEv2Landforms";
  import { ErosionResult } from "./WGEv2Erosion";
  import { ClimateResult } from "./WGEv2Climate";
  import { BiomeResult, BiomeId } from "./WGEv2Biomes";
  
  export type SettlementKind = "village" | "town" | "city";
  
  /**
   * A single proto-settlement site.
   * Coordinates are in grid cell indices for now.
   */
  export interface SettlementSite {
    id: string;
    x: number;
    y: number;
    kind: SettlementKind;
    biome: BiomeId;
    score: number;
  }
  
  /**
   * A road segment connects two settlements. Path = polyline over grid.
   * Later stages can refine this into actual road geometry.
   */
  export interface RoadSegment {
    id: string;
    from: string;
    to: string;
    path: { x: number; y: number }[];
  }
  
  /**
   * Simple POI categories; can be extended later.
   */
  export type PoiKind = "ruin" | "shrine" | "fort" | "mine" | "lair";
  
  export interface PointOfInterest {
    id: string;
    kind: PoiKind;
    x: number;
    y: number;
    biome: BiomeId;
  }
  
  /**
   * Tuning parameters for the civilization pass.
   */
  export interface CivilizationParams {
    maxSettlements: number;
    minDistanceBetweenSettlements: number; // in cells
    riverBias: number;
    lakeBias: number;
    coastBias: number;
    fertileMoistureMin: number;
    fertileMoistureMax: number;
    avoidExtremeTempBelow: number;
    avoidExtremeTempAbove: number;
    cityScoreThreshold: number;
    townScoreThreshold: number;
    poiCount: number;
  }
  
  /**
   * Input to the civ stage.
   */
  export interface CivilizationInput {
    landforms: LandformResult;
    erosion: ErosionResult;
    climate: ClimateResult;
    biomes: BiomeResult;
    shardSeed: number;
    params?: Partial<CivilizationParams>;
  }
  
  /**
   * Final output for this stage.
   */
  export interface CivilizationResult {
    width: number;
    height: number;
    settlements: SettlementSite[];
    roads: RoadSegment[];
    pointsOfInterest: PointOfInterest[];
  }
  
  const DEFAULT_PARAMS: CivilizationParams = {
    maxSettlements: 14,
    minDistanceBetweenSettlements: 32,
    riverBias: 0.35,
    lakeBias: 0.3,
    coastBias: 0.25,
    fertileMoistureMin: 0.35,
    fertileMoistureMax: 0.75,
    avoidExtremeTempBelow: -10,
    avoidExtremeTempAbove: 35,
    cityScoreThreshold: 0.8,
    townScoreThreshold: 0.55,
    poiCount: 24,
  };
  
  const CIVILIZATION_SEED_SALT = 0xc1e1c1e1; // just a stable arbitrary salt
  
  export class WGEv2CivilizationStage
  implements WorldGenStage<CivilizationInput, CivilizationResult>
  {
  public readonly name = "WGEv2Civilization";

  run(
    input: CivilizationInput,
    context?: WorldGenContext
  ): CivilizationResult {
      const logger = context?.logger;
  
      const { landforms, erosion, climate, biomes } = input;
      const width = landforms.width;
      const height = landforms.height;
  
      if (
        width !== erosion.width ||
        height !== erosion.height ||
        width !== climate.width ||
        height !== climate.height ||
        width !== biomes.width ||
        height !== biomes.height
      ) {
        throw new WorldGenError(
          `[${this.name}] Dimension mismatch between inputs.`
        );
      }
  
      const params: CivilizationParams = {
        ...DEFAULT_PARAMS,
        ...(input.params ?? {}),
      };
  
      const rng = createRng((input.shardSeed ^ CIVILIZATION_SEED_SALT) >>> 0);
  
      logger?.info?.(`[${this.name}] Selecting settlement sites…`, {
        width,
        height,
        maxSettlements: params.maxSettlements,
      });
  
      // 1. Score candidate cells for potential settlement
      const scores = new Float32Array(width * height);
      this.scoreSettlementCandidates(
        scores,
        landforms,
        erosion,
        climate,
        biomes,
        params
      );
  
      // 2. Select top N settlements with spacing constraints
      const settlements = this.pickSettlementSites(
        scores,
        landforms,
        biomes,
        params,
        rng
      );
  
      logger?.info?.(`[${this.name}] Selected settlements…`, {
        count: settlements.length,
      });
  
      // 3. Build a road graph between settlements (MST + extras)
      const roads = this.buildRoadNetwork(settlements, width, height);
  
      // 4. Place points of interest (ruins/shrines/mines/etc.)
      const pois = this.placePointsOfInterest(
        landforms,
        biomes,
        climate,
        params,
        rng
      );
  
      logger?.success?.(
        `[${this.name}] Civilization stage complete: settlements=${settlements.length}, roads=${roads.length}, pois=${pois.length}`
      );
  
      return {
        width,
        height,
        settlements,
        roads,
        pointsOfInterest: pois,
      };
    }
  
    // ---------------------------------------------------------------------------
    // SCORING
    // ---------------------------------------------------------------------------
  
    private scoreSettlementCandidates(
      scores: Float32Array,
      land: LandformResult,
      erosion: ErosionResult,
      climate: ClimateResult,
      biomes: BiomeResult,
      params: CivilizationParams
    ) {
      const width = land.width;
      const height = land.height;
      const seaLevel = land.metadata.seaLevel;
  
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
  
          const elev = land.elevation[idx];
          const moist = climate.moisture[idx];
          const temp = climate.temperature[idx];
          const biome = biomes.biomeMap[idx] as BiomeId;
  
          // Skip ocean, lakes, lava fields, etc.
          if (elev < seaLevel) {
            scores[idx] = 0;
            continue;
          }
  
          if (
            biome === BiomeId.LavaField ||
            biome === BiomeId.MagmaLake ||
            biome === BiomeId.BasaltPlateau
          ) {
            scores[idx] = 0;
            continue;
          }
  
          // Temperature suitability
          if (
            temp < params.avoidExtremeTempBelow ||
            temp > params.avoidExtremeTempAbove
          ) {
            scores[idx] = 0;
            continue;
          }
  
          // Base biome preference weighting
          let biomeScore = 0;
  
          switch (biome) {
            case BiomeId.Grassland:
            case BiomeId.Forest:
            case BiomeId.Savanna:
            case BiomeId.Wetlands:
            case BiomeId.BorealForest:
              biomeScore = 1.0;
              break;
            case BiomeId.Coast:
            case BiomeId.Beach:
              biomeScore = 0.85;
              break;
            case BiomeId.Desert:
            case BiomeId.Snow:
            case BiomeId.Alpine:
              biomeScore = 0.35;
              break;
            case BiomeId.Jungle:
              biomeScore = 0.65;
              break;
            default:
              biomeScore = 0.5;
          }
  
          // Moisture range preference (fertile band)
          let moistureScore = 0;
          if (
            moist >= params.fertileMoistureMin &&
            moist <= params.fertileMoistureMax
          ) {
            moistureScore = 1.0;
          } else if (moist < params.fertileMoistureMin) {
            const d = params.fertileMoistureMin - moist;
            moistureScore = Math.max(0, 1.0 - d * 4);
          } else {
            const d = moist - params.fertileMoistureMax;
            moistureScore = Math.max(0, 1.0 - d * 4);
          }
  
          // Proximity to water (rivers, lakes, coast)
          const isRiver = erosion.rivers[idx] > 0;
          const isLake = erosion.lakes[idx] > 0;
          const isCoast = biome === BiomeId.Coast || biome === BiomeId.Beach;
  
          let waterScore = 0;
          if (isRiver) waterScore += params.riverBias;
          if (isLake) waterScore += params.lakeBias;
          if (isCoast) waterScore += params.coastBias;
  
          // Gentle elevation preference (avoid very steep mountains/hills)
          const absElev = elev;
          let elevScore = 1.0;
          if (absElev > 0.8) {
            elevScore = 0.1;
          } else if (absElev > 0.5) {
            elevScore = 0.4;
          }
  
          // Combine scores (weighted)
          const combined =
            biomeScore * 0.4 +
            moistureScore * 0.3 +
            waterScore * 0.2 +
            elevScore * 0.1;
  
          scores[idx] = combined;
        }
      }
    }
  
    // ---------------------------------------------------------------------------
    // SETTLEMENT SELECTION
    // ---------------------------------------------------------------------------
  
    private pickSettlementSites(
      scores: Float32Array,
      land: LandformResult,
      biomes: BiomeResult,
      params: CivilizationParams,
      rng: () => number
    ): SettlementSite[] {
      const width = land.width;
      const height = land.height;
  
      // Build a list of candidate indices sorted by score descending
      const candidates: { idx: number; score: number }[] = [];
      for (let i = 0; i < scores.length; i++) {
        const s = scores[i];
        if (s > 0.1) {
          candidates.push({ idx: i, score: s });
        }
      }
  
      candidates.sort((a, b) => b.score - a.score);
  
      const chosen: SettlementSite[] = [];
      const minDistSq =
        params.minDistanceBetweenSettlements *
        params.minDistanceBetweenSettlements;
  
      for (const c of candidates) {
        if (chosen.length >= params.maxSettlements) break;
  
        const idx = c.idx;
        const x = idx % width;
        const y = Math.floor(idx / width);
  
        // Enforce spacing from existing settlements
        let tooClose = false;
        for (const settlement of chosen) {
          const dx = settlement.x - x;
          const dy = settlement.y - y;
          const distSq = dx * dx + dy * dy;
          if (distSq < minDistSq) {
            tooClose = true;
            break;
          }
        }
  
        if (tooClose) continue;
  
        // Set kind based on score
        let kind: SettlementKind;
        if (c.score >= params.cityScoreThreshold) {
          kind = "city";
        } else if (c.score >= params.townScoreThreshold) {
          kind = "town";
        } else {
          kind = "village";
        }
  
        const biome = biomes.biomeMap[idx] as BiomeId;
  
        const id = `settlement_${chosen.length}_${x}_${y}`;
        chosen.push({
          id,
          x,
          y,
          kind,
          biome,
          score: c.score,
        });
      }
  
      // Slight random shuffle of equal-score groups for variety
      for (let i = chosen.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = chosen[i];
        chosen[i] = chosen[j];
        chosen[j] = tmp;
      }
  
      return chosen;
    }
  
    // ---------------------------------------------------------------------------
    // ROAD NETWORK
    // ---------------------------------------------------------------------------
  
    private buildRoadNetwork(
      settlements: SettlementSite[],
      width: number,
      height: number
    ): RoadSegment[] {
      const roads: RoadSegment[] = [];
  
      if (settlements.length <= 1) {
        return roads;
      }
  
      // Compute a simple MST (Prim) over settlements using squared distance
      const n = settlements.length;
      const inTree = new Array<boolean>(n).fill(false);
      const dist = new Array<number>(n).fill(Infinity);
      const parent = new Array<number>(n).fill(-1);
  
      dist[0] = 0;
  
      for (let i = 0; i < n; i++) {
        let u = -1;
        let best = Infinity;
        for (let j = 0; j < n; j++) {
          if (!inTree[j] && dist[j] < best) {
            best = dist[j];
            u = j;
          }
        }
        if (u === -1) break;
        inTree[u] = true;
  
        for (let v = 0; v < n; v++) {
          if (inTree[v]) continue;
          const du = this.settlementDistanceSq(settlements[u], settlements[v]);
          if (du < dist[v]) {
            dist[v] = du;
            parent[v] = u;
          }
        }
      }
  
      // Build road segments
      for (let i = 1; i < n; i++) {
        const p = parent[i];
        if (p === -1) continue;
        const a = settlements[i];
        const b = settlements[p];
  
        const id = `road_${a.id}_${b.id}`;
        const path = this.straightLinePath(a.x, a.y, b.x, b.y, width, height);
  
        roads.push({
          id,
          from: a.id,
          to: b.id,
          path,
        });
      }
  
      // Optional: Add a few "secondary" edges between nearest neighbors
      const secondaryLimit = Math.min(4, n);
      for (let i = 0; i < n; i++) {
        const neighbors = this.findNearestSettlements(settlements, i, 3);
        let added = 0;
        for (const j of neighbors) {
          if (i === j) continue;
          const a = settlements[i];
          const b = settlements[j];
          if (a.id > b.id) continue; // Avoid duplicates via id ordering
  
          const exists = roads.some(
            (r) =>
              (r.from === a.id && r.to === b.id) ||
              (r.from === b.id && r.to === a.id)
          );
          if (exists) continue;
  
          const id = `road_secondary_${a.id}_${b.id}`;
          const path = this.straightLinePath(
            a.x,
            a.y,
            b.x,
            b.y,
            width,
            height
          );
  
          roads.push({
            id,
            from: a.id,
            to: b.id,
            path,
          });
  
          added++;
          if (added >= secondaryLimit) break;
        }
      }
  
      return roads;
    }
  
    private settlementDistanceSq(a: SettlementSite, b: SettlementSite): number {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      return dx * dx + dy * dy;
    }
  
    private straightLinePath(
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      width: number,
      height: number
    ): { x: number; y: number }[] {
      const path: { x: number; y: number }[] = [];
  
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
  
      let x = x0;
      let y = y0;
  
      while (true) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          path.push({ x, y });
        }
  
        if (x === x1 && y === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) {
          err -= dy;
          x += sx;
        }
        if (e2 < dx) {
          err += dx;
          y += sy;
        }
      }
  
      return path;
    }
  
    private findNearestSettlements(
      settlements: SettlementSite[],
      index: number,
      count: number
    ): number[] {
      const res: { idx: number; dist: number }[] = [];
      const a = settlements[index];
  
      for (let i = 0; i < settlements.length; i++) {
        if (i === index) continue;
        const d = this.settlementDistanceSq(a, settlements[i]);
        res.push({ idx: i, dist: d });
      }
  
      res.sort((x, y) => x.dist - y.dist);
      return res.slice(0, count).map((r) => r.idx);
    }
  
    // ---------------------------------------------------------------------------
    // POINTS OF INTEREST
    // ---------------------------------------------------------------------------
  
    private placePointsOfInterest(
      land: LandformResult,
      biomes: BiomeResult,
      climate: ClimateResult, // kept for future tuning
      params: CivilizationParams,
      rng: () => number
    ): PointOfInterest[] {
      const width = land.width;
      const height = land.height;
  
      const pois: PointOfInterest[] = [];
      const maxAttempts = params.poiCount * 10;
  
      const isAllowedBiome = (b: BiomeId): boolean => {
        switch (b) {
          case BiomeId.Desert:
          case BiomeId.Jungle:
          case BiomeId.Alpine:
          case BiomeId.Snow:
          case BiomeId.VolcanicPlain:
          case BiomeId.LavaField:
          case BiomeId.BasaltPlateau:
            return true;
          default:
            // general forests, grasslands, wetlands can also get POIs
            return true;
        }
      };
  
      const pickKindForBiome = (b: BiomeId): PoiKind => {
        switch (b) {
          case BiomeId.VolcanicPlain:
          case BiomeId.LavaField:
          case BiomeId.BasaltPlateau:
            return "shrine";
          case BiomeId.Desert:
            return "ruin";
          case BiomeId.Jungle:
            return "shrine";
          case BiomeId.Alpine:
          case BiomeId.Snow:
            return "fort";
          default:
            return rng() < 0.5 ? "ruin" : "mine";
        }
      };
  
      let attempts = 0;
      while (pois.length < params.poiCount && attempts < maxAttempts) {
        attempts++;
  
        const x = Math.floor(rng() * width);
        const y = Math.floor(rng() * height);
        const idx = y * width + x;
  
        const biome = biomes.biomeMap[idx] as BiomeId;
        const elev = land.elevation[idx];
  
        if (!isAllowedBiome(biome)) continue;
        if (elev < land.metadata.seaLevel) continue; // no underwater POIs for now
  
        const kind = pickKindForBiome(biome);
        const id = `poi_${kind}_${pois.length}_${x}_${y}`;
  
        pois.push({
          id,
          kind,
          x,
          y,
          biome,
        });
      }
  
      return pois;
    }
  }
  