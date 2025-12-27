//worldcore/terrain/worldgen/WGEv2Resources.ts

/**
 * PLANAR WAR – WORLD GENERATION ENGINE V2
 * Stage 2.3.6 — Resource Placement (Production Edition)
 *
 * Responsibilities:
 *  - Place resource nodes (ore, herbs, wood, fish, rare/magic) across the world.
 *  - Respect biome, elevation, climate (temperature & moisture), and hydrology.
 *  - Avoid overcrowding (min spacing) and avoid city centers (for now).
 *  - Provide compact masks for quick lookup by later systems.
 *
 * Inputs:
 *  - LandformResult
 *  - ErosionResult
 *  - ClimateResult
 *  - BiomeResult
 *  - CivilizationResult
 *
 * Outputs:
 *  - ResourceResult:
 *      • nodes: ResourceNode[]
 *      • masks: Uint8Array per kind (0/1 per cell)
 */

 import {
    LandformResult,
    WorldGenStage,
    WorldGenContext,
    WorldGenError,
    createRng
  } from "./WGEv2Landforms";
  
  import { ErosionResult } from "./WGEv2Erosion";
  import { ClimateResult } from "./WGEv2Climate";
  import { BiomeResult, BiomeId } from "./WGEv2Biomes";
  import {
    CivilizationResult,
    SettlementSite
  } from "./WGEv2Civilization";
  
  const RESOURCE_SEED_SALT = 0x9e3779b1; // arbitrary hex salt for resource RNG 

  export type ResourceKind = "ore" | "herb" | "wood" | "fish" | "rare";
  
  /**
   * A single resource spawn node.
   * Coordinates are in grid cell indices (same space as landforms).
   */
  export interface ResourceNode {
    id: string;
    kind: ResourceKind;
    subtype: string;       // e.g., "iron_ore", "silverleaf", "oak_log", "river_fish", "fire_crystal"
    x: number;
    y: number;
    biome: BiomeId;
    nearSettlementId?: string;
  }
  
  /**
   * Tuning parameters for global resource placement.
   */
  export interface ResourceParams {
    globalDensity: number;        // Global density multiplier
    oreDensity: number;           // Baseline per-cell chance for ore
    herbDensity: number;
    woodDensity: number;
    fishDensity: number;
    rareDensity: number;
    minDistance: number;          // Minimum distance (cells) between nodes of same kind
    settlementAvoidRadius: number;// Radius around settlements to reduce nodes
    settlementNearRadius: number; // Radius considered "near" for tagging
  }
  
  /**
   * Input for the resource stage.
   */
  export interface ResourceInput {
    landforms: LandformResult;
    erosion: ErosionResult;
    climate: ClimateResult;
    biomes: BiomeResult;
    civilization: CivilizationResult;
    shardSeed: number;
    params?: Partial<ResourceParams>;
  }
  
  /**
   * Output of the resource stage.
   */
  export interface ResourceResult {
    width: number;
    height: number;
    nodes: ResourceNode[];
  
    oreMask: Uint8Array;
    herbMask: Uint8Array;
    woodMask: Uint8Array;
    fishMask: Uint8Array;
    rareMask: Uint8Array;
  }
  
  const DEFAULT_RESOURCE_PARAMS: ResourceParams = {
    globalDensity: 1.0,
    oreDensity: 0.0008,
    herbDensity: 0.0012,
    woodDensity: 0.0014,
    fishDensity: 0.0015,
    rareDensity: 0.0002,
    minDistance: 6,
    settlementAvoidRadius: 16,
    settlementNearRadius: 32
  };
  
  export class WGEv2ResourcesStage
  implements WorldGenStage<ResourceInput, ResourceResult>
{
  public readonly name = "WGEv2Resources";

  run(
    input: ResourceInput,
    context?: WorldGenContext
  ): ResourceResult {
      const logger = context?.logger;
      const { landforms, erosion, climate, biomes, civilization } = input;
  
      const width = landforms.width;
      const height = landforms.height;
  
      if (
        width !== erosion.width ||
        height !== erosion.height ||
        width !== climate.width ||
        height !== climate.height ||
        width !== biomes.width ||
        height !== biomes.height ||
        width !== civilization.width ||
        height !== civilization.height
      ) {
        throw new WorldGenError(
          `[${this.name}] Dimension mismatch between inputs.`
        );
      }
  
      const params: ResourceParams = {
        ...DEFAULT_RESOURCE_PARAMS,
        ...(input.params ?? {})
      };
  
      const rng = createRng((input.shardSeed ^ RESOURCE_SEED_SALT) >>> 0);
  
      logger?.info?.(
        `[${this.name}] Placing resources…`,
        {
          width,
          height,
          globalDensity: params.globalDensity
        }
      );
  
      const oreMask = new Uint8Array(width * height);
      const herbMask = new Uint8Array(width * height);
      const woodMask = new Uint8Array(width * height);
      const fishMask = new Uint8Array(width * height);
      const rareMask = new Uint8Array(width * height);
  
      const nodes: ResourceNode[] = [];
  
      // Precompute distance-to-settlement for density modulation & tagging
      const settlementDist = this.computeSettlementDistance(
        width,
        height,
        civilization.settlements
      );
  
      const minDistSq = params.minDistance * params.minDistance;
      const seaLevel = landforms.metadata.seaLevel;
  
      // For quick lookups per kind
      const oreNodes: ResourceNode[] = [];
      const herbNodes: ResourceNode[] = [];
      const woodNodes: ResourceNode[] = [];
      const fishNodes: ResourceNode[] = [];
      const rareNodes: ResourceNode[] = [];
  
      // ------------------------------------------------------------------
      // MAIN GRID PASS: Evaluate each cell for each resource kind
      // ------------------------------------------------------------------
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
  
          const elev = landforms.elevation[idx];
          const biome = biomes.biomeMap[idx] as BiomeId;
          const moist = climate.moisture[idx];
          const temp = climate.temperature[idx];
          const isRiver = erosion.rivers[idx] > 0;
          const isLake = erosion.lakes[idx] > 0;
          const isSea = elev < seaLevel;
  
          const distToSet = settlementDist[idx];
  
          // Density modifier near settlements: fewer wild resources *inside* towns
          let densityMod = 1.0;
          if (distToSet < params.settlementAvoidRadius) {
            const t = distToSet / params.settlementAvoidRadius; // 0..1
            densityMod *= Math.max(0.2, t); // reduce heavily near center
          }
  
          // 1) Ore
          {
            const p = this.oreSpawnChance(
              biome,
              elev,
              moist,
              temp,
              isRiver,
              isLake,
              isSea,
              params
            ) * params.globalDensity * densityMod;
  
            if (p > 0 && rng() < p && this.canPlaceHere(x, y, oreNodes, minDistSq)) {
              const subtype = pickOreSubtype(biome, elev, temp, rng);
              const nearSettlementId = distToSet <= params.settlementNearRadius
                ? nearestSettlementId(x, y, civilization.settlements)
                : undefined;
  
              const id = `ore_${subtype}_${nodes.length}_${x}_${y}`;
              const node: ResourceNode = {
                id,
                kind: "ore",
                subtype,
                x,
                y,
                biome,
                nearSettlementId
              };
              nodes.push(node);
              oreNodes.push(node);
              oreMask[idx] = 1;
            }
          }
  
          // 2) Herb
          {
            const p = this.herbSpawnChance(
              biome,
              elev,
              moist,
              temp,
              isRiver,
              isLake,
              isSea,
              params
            ) * params.globalDensity * densityMod;
  
            if (p > 0 && rng() < p && this.canPlaceHere(x, y, herbNodes, minDistSq)) {
              const subtype = pickHerbSubtype(biome, moist, temp, rng);
              const nearSettlementId = distToSet <= params.settlementNearRadius
                ? nearestSettlementId(x, y, civilization.settlements)
                : undefined;
  
              const id = `herb_${subtype}_${nodes.length}_${x}_${y}`;
              const node: ResourceNode = {
                id,
                kind: "herb",
                subtype,
                x,
                y,
                biome,
                nearSettlementId
              };
              nodes.push(node);
              herbNodes.push(node);
              herbMask[idx] = 1;
            }
          }
  
          // 3) Wood
          {
            const p = this.woodSpawnChance(
              biome,
              elev,
              moist,
              temp,
              isSea,
              params
            ) * params.globalDensity * densityMod;
  
            if (p > 0 && rng() < p && this.canPlaceHere(x, y, woodNodes, minDistSq)) {
              const subtype = pickWoodSubtype(biome, rng);
              const nearSettlementId = distToSet <= params.settlementNearRadius
                ? nearestSettlementId(x, y, civilization.settlements)
                : undefined;
  
              const id = `wood_${subtype}_${nodes.length}_${x}_${y}`;
              const node: ResourceNode = {
                id,
                kind: "wood",
                subtype,
                x,
                y,
                biome,
                nearSettlementId
              };
              nodes.push(node);
              woodNodes.push(node);
              woodMask[idx] = 1;
            }
          }
  
          // 4) Fish
          {
            const p = this.fishSpawnChance(
              biome,
              elev,
              moist,
              temp,
              isRiver,
              isLake,
              isSea,
              params
            ) * params.globalDensity * densityMod;
  
            if (p > 0 && rng() < p && this.canPlaceHere(x, y, fishNodes, minDistSq)) {
              const subtype = pickFishSubtype(isSea, isRiver, isLake, temp, rng);
              const nearSettlementId = distToSet <= params.settlementNearRadius
                ? nearestSettlementId(x, y, civilization.settlements)
                : undefined;
  
              const id = `fish_${subtype}_${nodes.length}_${x}_${y}`;
              const node: ResourceNode = {
                id,
                kind: "fish",
                subtype,
                x,
                y,
                biome,
                nearSettlementId
              };
              nodes.push(node);
              fishNodes.push(node);
              fishMask[idx] = 1;
            }
          }
  
          // 5) Rare/Magic
          {
            const p = this.rareSpawnChance(
              biome,
              elev,
              moist,
              temp,
              landforms.tectonics.uplift[idx],
              isSea,
              params
            ) * params.globalDensity * densityMod;
  
            if (p > 0 && rng() < p && this.canPlaceHere(x, y, rareNodes, minDistSq)) {
              const subtype = pickRareSubtype(biome, elev, temp, rng);
              const nearSettlementId = distToSet <= params.settlementNearRadius
                ? nearestSettlementId(x, y, civilization.settlements)
                : undefined;
  
              const id = `rare_${subtype}_${nodes.length}_${x}_${y}`;
              const node: ResourceNode = {
                id,
                kind: "rare",
                subtype,
                x,
                y,
                biome,
                nearSettlementId
              };
              nodes.push(node);
              rareNodes.push(node);
              rareMask[idx] = 1;
            }
          }
        }
      }
  
      logger?.success?.(
        `[${this.name}] Resource placement complete: nodes=${nodes.length}`
      );
  
      return {
        width,
        height,
        nodes,
        oreMask,
        herbMask,
        woodMask,
        fishMask,
        rareMask
      };
    }
  
    // ---------------------------------------------------------------------------
    // Distance to settlements (BFS from settlement sites)
    // ---------------------------------------------------------------------------
  
    private computeSettlementDistance(
      width: number,
      height: number,
      settlements: SettlementSite[]
    ): Float32Array {
      const maxDist = 255;
      const dist = new Float32Array(width * height);
      for (let i = 0; i < dist.length; i++) dist[i] = maxDist;
  
      const qx = new Int16Array(width * height);
      const qy = new Int16Array(width * height);
      let head = 0;
      let tail = 0;
  
      const enqueue = (x: number, y: number, d: number) => {
        const idx = y * width + x;
        if (d < dist[idx]) {
          dist[idx] = d;
          qx[tail] = x;
          qy[tail] = y;
          tail++;
        }
      };
  
      for (const s of settlements) {
        enqueue(s.x, s.y, 0);
      }
  
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ] as const;
  
      while (head < tail) {
        const x = qx[head];
        const y = qy[head];
        const baseIdx = y * width + x;
        const baseDist = dist[baseIdx];
        head++;
  
        if (baseDist >= maxDist) continue;
  
        for (const [dx, dy] of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
  
          const nIdx = ny * width + nx;
          const nd = baseDist + 1;
          if (nd < dist[nIdx]) {
            dist[nIdx] = nd;
            qx[tail] = nx;
            qy[tail] = ny;
            tail++;
          }
        }
      }
  
      return dist;
    }
  
    // ---------------------------------------------------------------------------
    // Spawn chances per kind
    // ---------------------------------------------------------------------------
  
    private oreSpawnChance(
      biome: BiomeId,
      elev: number,
      moist: number,
      temp: number,
      isRiver: boolean,
      isLake: boolean,
      isSea: boolean,
      params: ResourceParams
    ): number {
      if (isSea) return 0;
  
      let base = params.oreDensity;
  
      // Biome-based adjustments
      switch (biome) {
        case BiomeId.VolcanicPlain:
        case BiomeId.LavaField:
        case BiomeId.BasaltPlateau:
          base *= 4.0;
          break;
        case BiomeId.Alpine:
        case BiomeId.Snow:
          base *= 2.5;
          break;
        case BiomeId.Desert:
          base *= 1.8;
          break;
        case BiomeId.Forest:
        case BiomeId.BorealForest:
        case BiomeId.Grassland:
        case BiomeId.Savanna:
          base *= 1.0;
          break;
        default:
          base *= 0.8;
          break;
      }
  
      // Slight bonus near rivers/lakes (mining along riverbeds)
      if (isRiver || isLake) base *= 1.3;
  
      // Avoid extremely low or extremely high temps for surface ore
      if (temp < -15 || temp > 45) base *= 0.4;
  
      return base;
    }
  
    private herbSpawnChance(
      biome: BiomeId,
      elev: number,
      moist: number,
      temp: number,
      isRiver: boolean,
      isLake: boolean,
      isSea: boolean,
      params: ResourceParams
    ): number {
      if (isSea) return 0;
  
      let base = params.herbDensity;
  
      switch (biome) {
        case BiomeId.Grassland:
        case BiomeId.Forest:
        case BiomeId.Savanna:
        case BiomeId.Wetlands:
          base *= 2.0;
          break;
        case BiomeId.BorealForest:
        case BiomeId.Jungle:
          base *= 1.6;
          break;
        case BiomeId.Desert:
          base *= 0.4;
          break;
        case BiomeId.VolcanicPlain:
        case BiomeId.LavaField:
          base *= 0.2;
          break;
        default:
          base *= 0.8;
          break;
      }
  
      // Moisture sweet spot
      if (moist < 0.2 || moist > 0.9) base *= 0.4;
  
      if (isRiver || isLake) base *= 1.8;
  
      return base;
    }
  
    private woodSpawnChance(
      biome: BiomeId,
      elev: number,
      moist: number,
      temp: number,
      isSea: boolean,
      params: ResourceParams
    ): number {
      if (isSea) return 0;
  
      let base = params.woodDensity;
  
      switch (biome) {
        case BiomeId.Forest:
        case BiomeId.BorealForest:
        case BiomeId.Jungle:
          base *= 3.0;
          break;
        case BiomeId.Savanna:
        case BiomeId.Wetlands:
          base *= 1.8;
          break;
        case BiomeId.Grassland:
          base *= 0.6;
          break;
        case BiomeId.Desert:
        case BiomeId.VolcanicPlain:
        case BiomeId.LavaField:
          base *= 0.2;
          break;
        default:
          base *= 0.5;
          break;
      }
  
      return base;
    }
  
    private fishSpawnChance(
      biome: BiomeId,
      elev: number,
      moist: number,
      temp: number,
      isRiver: boolean,
      isLake: boolean,
      isSea: boolean,
      params: ResourceParams
    ): number {
      if (!isSea && !isRiver && !isLake) return 0;
  
      let base = params.fishDensity;
  
      if (isSea) base *= 2.5;
      if (isRiver) base *= 2.0;
      if (isLake) base *= 1.6;
  
      // Cold or hot extremes slightly reduce
      if (temp < -5 || temp > 35) base *= 0.7;
  
      return base;
    }
  
    private rareSpawnChance(
      biome: BiomeId,
      elev: number,
      moist: number,
      temp: number,
      uplift: number,
      isSea: boolean,
      params: ResourceParams
    ): number {
      let base = params.rareDensity;
  
      // Rare nodes prefer extremes & special biomes
      switch (biome) {
        case BiomeId.VolcanicPlain:
        case BiomeId.LavaField:
        case BiomeId.BasaltPlateau:
          base *= 4.0;
          break;
        case BiomeId.Jungle:
        case BiomeId.Desert:
        case BiomeId.Alpine:
        case BiomeId.Snow:
          base *= 2.0;
          break;
        default:
          base *= 0.7;
          break;
      }
  
      if (uplift > 0.6) base *= 1.8;
      if (uplift > 0.9) base *= 2.5;
  
      if (isSea) base *= 0.3;
  
      return base;
    }
  
    // ---------------------------------------------------------------------------
    // Spacing & helpers
    // ---------------------------------------------------------------------------
  
    private canPlaceHere(
      x: number,
      y: number,
      existing: ResourceNode[],
      minDistSq: number
    ): boolean {
      for (const n of existing) {
        const dx = n.x - x;
        const dy = n.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minDistSq) return false;
      }
      return true;
    }
  }
  
  // -----------------------------------------------------------------------------
  // Subtype pickers
  // -----------------------------------------------------------------------------
  
  function pickOreSubtype(
    biome: BiomeId,
    elev: number,
    temp: number,
    rng: () => number
  ): string {
    // Very rough theming
    if (
      biome === BiomeId.VolcanicPlain ||
      biome === BiomeId.LavaField ||
      biome === BiomeId.BasaltPlateau
    ) {
      const roll = rng();
      if (roll < 0.4) return "obsidian_ore";
      if (roll < 0.7) return "fire_crystal_ore";
      return "basalt_fragment";
    }
  
    if (biome === BiomeId.Desert) {
      return rng() < 0.5 ? "copper_ore" : "silver_ore";
    }
  
    if (elev > 0.6) {
      return rng() < 0.6 ? "iron_ore" : "mithril_ore";
    }
  
    return rng() < 0.5 ? "iron_ore" : "copper_ore";
  }
  
  function pickHerbSubtype(
    biome: BiomeId,
    moist: number,
    temp: number,
    rng: () => number
  ): string {
    if (biome === BiomeId.Jungle) {
      return rng() < 0.5 ? "jungle_spice" : "bloodvine";
    }
    if (biome === BiomeId.Wetlands) {
      return rng() < 0.5 ? "swamp_reed" : "marsh_bloom";
    }
    if (biome === BiomeId.Forest || biome === BiomeId.BorealForest) {
      return rng() < 0.5 ? "forest_mint" : "silverleaf";
    }
    if (biome === BiomeId.Desert) {
      return rng() < 0.6 ? "cactus_bloom" : "sun_thistle";
    }
    return rng() < 0.5 ? "plain_wort" : "meadow_rose";
  }
  
  function pickWoodSubtype(
    biome: BiomeId,
    rng: () => number
  ): string {
    if (biome === BiomeId.Jungle) {
      return rng() < 0.5 ? "jungle_wood" : "darkheart_wood";
    }
    if (biome === BiomeId.BorealForest || biome === BiomeId.Snow) {
      return rng() < 0.5 ? "pine_log" : "spruce_log";
    }
    if (biome === BiomeId.Forest) {
      return rng() < 0.5 ? "oak_log" : "birch_log";
    }
    if (biome === BiomeId.Savanna) {
      return "acacia_log";
    }
    return "scrub_wood";
  }
  
  function pickFishSubtype(
    isSea: boolean,
    isRiver: boolean,
    isLake: boolean,
    temp: number,
    rng: () => number
  ): string {
    if (isSea) {
      return rng() < 0.5 ? "sea_bass" : "tide_sardine";
    }
    if (isRiver) {
      if (temp < 5) return "cold_trout";
      return rng() < 0.5 ? "river_trout" : "silver_carp";
    }
    if (isLake) {
      return rng() < 0.5 ? "lake_perch" : "mud_catfish";
    }
    return "mystery_fish";
  }
  
  function pickRareSubtype(
    biome: BiomeId,
    elev: number,
    temp: number,
    rng: () => number
  ): string {
    if (
      biome === BiomeId.VolcanicPlain ||
      biome === BiomeId.LavaField ||
      biome === BiomeId.BasaltPlateau
    ) {
      return rng() < 0.5 ? "ember_core" : "molten_heart";
    }
    if (biome === BiomeId.Jungle) {
      return rng() < 0.5 ? "ancient_idol" : "glowing_orchid";
    }
    if (biome === BiomeId.Desert) {
      return rng() < 0.5 ? "sunstone" : "buried_relic";
    }
    if (elev > 0.7) {
      return rng() < 0.5 ? "sky_crystal" : "frost_gem";
    }
    return rng() < 0.5 ? "ley_fragment" : "forgotten_totem";
  }
  
  // -----------------------------------------------------------------------------
  // Nearest settlement helper
  // -----------------------------------------------------------------------------
  
  function nearestSettlementId(
    x: number,
    y: number,
    settlements: SettlementSite[]
  ): string | undefined {
    if (settlements.length === 0) return undefined;
  
    let bestId = settlements[0].id;
    let bestDist = Infinity;
  
    for (const s of settlements) {
      const dx = s.x - x;
      const dy = s.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        bestId = s.id;
      }
    }
  
    return bestId;
  }
  