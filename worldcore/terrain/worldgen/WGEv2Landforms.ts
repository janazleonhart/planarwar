//worldcore/terrain/worldgen/WGEv2Landforms.ts

/**
 * PLANAR WAR – WORLD GENERATION ENGINE V2
 * Stage 2.3.1 — Base Landform Pass (Large-Scale Elevation)
 *
 * This module is written to be compatible with:
 *  - Node backend (Planar War server)
 *  - Future hybrid engines / clients as a pure TypeScript reference
 *
 * Responsibilities:
 *  - Generate a deterministic base elevation field from a shard seed.
 *  - Simulate tectonic plates, continents, uplift, rifts, and macro noise.
 *  - Produce biome hint codes for later climate / biome passes.
 *  - Expose helpers to sample elevation and extract chunks for streaming.
 */

//////////////////////
// Shared Interfaces
//////////////////////

const LANDFORM_SALT = 0x165667b1;

/**
 * High-level world “profile” that shapes the rough macro terrain behavior.
 */
 export type WorldProfile =
 | "STABLE_PRIME"
 | "CHAOTIC_PRIME"
 | "BROKEN_SHARD"
 | "ELEMENTAL_TILT"
 | "ARCANE_DISTORTED";

/**
* Configurable numeric knobs for the landform generator.
* These can later be overridden from config files or database.
*/
export interface LandformParams {
 continentCountMin: number;
 continentCountMax: number;

 plateCountMin: number;
 plateCountMax: number;

 mountainUpliftStrength: number;
 riftStrength: number;
 foldingFrequency: number;
 erosionBias: number;

 /** Base sea level before normalization, in [-1, 1]. */
 baseSeaLevel: number;

 /** Overall vertical scale before final normalization. */
 baseElevationScale: number;
}

/**
* Input to this worldgen stage for a single shard.
*/
export interface ShardSeedInput {
 shardId: string;
 width: number;
 height: number;
 seed: number;
 profile: WorldProfile;
 params?: Partial<LandformParams>;
}

/**
* Minimal logger contract to avoid binding to a specific implementation.
* You can adapt your utils/logger.ts to satisfy this interface.
*/
export interface ILogger {
 debug?(msg: string, meta?: unknown): void;
 info(msg: string, meta?: unknown): void;
 warn(msg: string, meta?: unknown): void;
 error(msg: string, meta?: unknown): void;
 // ✅ add this so WGEv2Biomes / Erosion / Civilization / Resources compile
 success?(msg: string, meta?: unknown): void;
}

/**
* Optional context passed to all worldgen stages.
* Additional shared services (metrics, tracing) can be added later.
*/
export interface WorldGenContext {
 logger?: ILogger;
}

/**
* Generic stage interface for WGEv2.
* Other stages (Erosion, Climate, Biomes, etc.) should implement this too.
*/
export interface WorldGenStage<I, O> {
  readonly name: string;
  run(input: I, context?: WorldGenContext): O;
}

/**
* Metadata about the generated landform, for later stages and debugging.
*/
export interface LandformMetadata {
 seaLevel: number;     // always 0.0 after normalization
 minHeight: number;    // -1 in normalized space
 maxHeight: number;    //  1 in normalized space
 plateCount: number;
 continentCount: number;
}

/**
* Per-cell tectonic info, stored in typed arrays aligned with the heightmap.
*/
export interface TectonicField {
 plateId: Uint8Array;       // [0..plateCount-1]
 compression: Float32Array; // arbitrary scale (0..∞, practically 0..~1)
 uplift: Float32Array;      // added elevation contribution from tectonics
}

/**
* Macro biome hints taken from this pass alone.
* Later climate / biome stages will refine this.
*/
export type BiomeHintCode = 0 | 1 | 2 | 3 | 4 | 5;
// 0 = Deep sea
// 1 = Shelf / coast
// 2 = Lowlands / basins
// 3 = Highlands / plateaus
// 4 = Mountain chains
// 5 = Volcanic / crater zones

/**
* Core output of this stage.
*/
export interface LandformResult {
 shardId: string;
 width: number;
 height: number;
 elevation: Float32Array;  // normalized [-1, 1], seaLevel = 0
 tectonics: TectonicField;
 biomeHints: Uint8Array;   // BiomeHintCode per cell
 metadata: LandformMetadata;
}

/**
* Compact structure that can be embedded into a WorldBlueprint
* or streamed to the client as part of a “landform blueprint”.
*/
export interface LandformBlueprint {
 shardId: string;
 width: number;
 height: number;
 seaLevel: number;
 minHeight: number;
 maxHeight: number;
 elevation: Float32Array;  // same buffer as LandformResult.elevation
 biomeHints: Uint8Array;   // same buffer
}

//////////////////////////
// Errors & Default Params
//////////////////////////

export class WorldGenError extends Error {
 constructor(message: string) {
   super(message);
   this.name = "WorldGenError";
 }
}

const DEFAULT_PARAMS: LandformParams = {
 continentCountMin: 1,
 continentCountMax: 4,
 plateCountMin: 3,
 plateCountMax: 7,
 mountainUpliftStrength: 1.2,
 riftStrength: 0.8,
 foldingFrequency: 1.2,
 erosionBias: 1.0,
 baseSeaLevel: -0.1,
 baseElevationScale: 1.0
};

//////////////////////////
// RNG & Noise Utilities
//////////////////////////

/**
* Mulberry32 PRNG – simple, deterministic, and fast.
* Safe for worldgen, not cryptography.
*/
export function createRng(seed: number): () => number {
 let t = seed >>> 0;
 return () => {
   t += 0x6D2B79F5;
   let x = t;
   x = Math.imul(x ^ (x >>> 15), 1 | x);
   x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
   return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
 };
}

/**
* Simple 2D value noise with smooth interpolation.
* Not as fancy as proper Perlin/Simplex but plenty for macro terrain.
*/
class ValueNoise2D {
 private grid: Float32Array;
 private gridSize: number;

 constructor(seed: number, gridSize = 256) {
   this.gridSize = gridSize;
   const rng = createRng(seed);
   this.grid = new Float32Array(gridSize * gridSize);
   for (let i = 0; i < this.grid.length; i++) {
     this.grid[i] = rng() * 2 - 1; // [-1,1]
   }
 }

 private sampleGrid(ix: number, iy: number): number {
   const x = ((ix % this.gridSize) + this.gridSize) % this.gridSize;
   const y = ((iy % this.gridSize) + this.gridSize) % this.gridSize;
   return this.grid[y * this.gridSize + x];
 }

 /**
  * Sample noise at (x, y) with given frequency.
  */
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
* Fractional Brownian motion wrapper over ValueNoise2D.
*/
function fbm(
 noise: ValueNoise2D,
 x: number,
 y: number,
 octaves: number,
 gain: number,
 lacunarity: number,
 baseFrequency: number
): number {
 let amp = 1.0;
 let freq = baseFrequency;
 let sum = 0;
 let totalAmp = 0;

 for (let i = 0; i < octaves; i++) {
   sum += noise.sample(x, y, freq) * amp;
   totalAmp += amp;
   amp *= gain;
   freq *= lacunarity;
 }

 return sum / totalAmp; // roughly [-1,1]
}

//////////////////////////
// Tectonic Structures
//////////////////////////

interface Plate {
 id: number;
 centerX: number; // 0..1
 centerY: number; // 0..1
 driftX: number;
 driftY: number;
 compression: number;  // 0..1
 elementalBias: number; // -1..1 (if elemental tilt)
}

function generatePlates(
 width: number,
 height: number,
 rng: () => number,
 profile: WorldProfile,
 params: LandformParams
): { plates: Plate[]; plateField: Uint8Array } {
 let plateCountMin = params.plateCountMin;
 let plateCountMax = params.plateCountMax;

 switch (profile) {
   case "STABLE_PRIME":
     plateCountMax = Math.max(plateCountMin + 1, 4);
     break;
   case "CHAOTIC_PRIME":
   case "BROKEN_SHARD":
     plateCountMin = Math.max(plateCountMin + 1, 5);
     break;
   case "ELEMENTAL_TILT":
   case "ARCANE_DISTORTED":
     // use full range
     break;
 }

 const plateCount =
   plateCountMin + Math.floor(rng() * (plateCountMax - plateCountMin + 1));

 const plates: Plate[] = [];
 for (let i = 0; i < plateCount; i++) {
   const angle = rng() * Math.PI * 2;
   const speed = 0.1 + rng() * 0.3;
   const driftX = Math.cos(angle) * speed;
   const driftY = Math.sin(angle) * speed;

   let compressionBase = rng();
   if (profile === "STABLE_PRIME") compressionBase *= 0.6;
   if (profile === "CHAOTIC_PRIME" || profile === "BROKEN_SHARD") {
     compressionBase = 0.4 + rng() * 0.6;
   }

   const elementalBias =
     profile === "ELEMENTAL_TILT" ? (rng() * 2 - 1) : 0;

   plates.push({
     id: i,
     centerX: rng(),
     centerY: rng(),
     driftX,
     driftY,
     compression: compressionBase,
     elementalBias
   });
 }

 const plateField = new Uint8Array(width * height);

 for (let y = 0; y < height; y++) {
   const ny = y / (height - 1);
   for (let x = 0; x < width; x++) {
     const nx = x / (width - 1);
     let best = 0;
     let bestDist = Infinity;

     for (let i = 0; i < plates.length; i++) {
       const dx = nx - plates[i].centerX;
       const dy = ny - plates[i].centerY;
       const d2 = dx * dx + dy * dy;
       if (d2 < bestDist) {
         bestDist = d2;
         best = i;
       }
     }

     plateField[y * width + x] = best;
   }
 }

 return { plates, plateField };
}

//////////////////////////
// Core Stage Implementation
//////////////////////////

/**
* WGEv2LandformsStage
*
* Usage:
*   const stage = new WGEv2LandformsStage();
*   const result = await stage.run({ shardId, width, height, seed, profile });
*/
export class WGEv2LandformsStage
  implements WorldGenStage<ShardSeedInput, LandformResult>
  {
    public readonly name = "WGEv2Landforms";

    run(
    input: ShardSeedInput,
    context?: WorldGenContext
    ): LandformResult {
   const { shardId, width, height, seed, profile } = input;

   if (width <= 0 || height <= 0) {
     throw new WorldGenError(
       `WGEv2Landforms: invalid dimensions width=${width}, height=${height}`
     );
   }

   const logger = context?.logger;
   logger?.info(`[${this.name}] Generating landforms for shard ${shardId}`, {
     shardId,
     width,
     height,
     seed,
     profile
   });

   const params: LandformParams = { ...DEFAULT_PARAMS, ...(input.params ?? {}) };
   const rng = createRng(seed >>> 0);

   const elevation = new Float32Array(width * height);
   const compression = new Float32Array(width * height);
   const uplift = new Float32Array(width * height);
   const plateField = new Uint8Array(width * height);
   const biomeHints = new Uint8Array(width * height);

   // Dedicated noise fields
   const macroNoise = new ValueNoise2D((seed ^ 0xA5A5A5A5) >>> 0);
   const foldNoise = new ValueNoise2D((seed ^ 0xF00DBABE) >>> 0);
   const detailNoise = new ValueNoise2D((seed ^ 0xDEADBEEF) >>> 0);

   // Plates
   const { plates, plateField: plateAssign } = generatePlates(
     width,
     height,
     rng,
     profile,
     params
   );
   plateField.set(plateAssign);

   const plateCount = plates.length;

   // Continents
   const continentCount =
     params.continentCountMin +
     Math.floor(
       rng() * (params.continentCountMax - params.continentCountMin + 1)
     );

   const oceanBias =
     profile === "BROKEN_SHARD" ? 0.7 :
     profile === "CHAOTIC_PRIME" ? 0.4 :
     0.3;

   // STEP 1 — Macro continent shapes
   for (let y = 0; y < height; y++) {
     const ny = y / (height - 1);
     for (let x = 0; x < width; x++) {
       const nx = x / (width - 1);
       const idx = y * width + x;

       const macro = fbm(
         macroNoise,
         nx,
         ny,
         3,
         0.5,
         2.0,
         0.7 + (continentCount - 1) * 0.3
       ); // [-1,1]

       let continentMask = (macro + 1) * 0.5; // [0,1]
       continentMask = Math.pow(continentMask, 1.2);

       const base = (continentMask - oceanBias) * params.baseElevationScale;
       elevation[idx] = base;
     }
   }

   // STEP 2 — Tectonic uplift & rifts
   for (let y = 0; y < height; y++) {
     const ny = y / (height - 1);
     for (let x = 0; x < width; x++) {
       const nx = x / (width - 1);
       const idx = y * width + x;
       const plateId = plateField[idx];
       const plate = plates[plateId];

       let localCompression = 0;
       let localUplift = 0;
       let localRift = 0;

       const neighbors = [
         [x + 1, y],
         [x - 1, y],
         [x, y + 1],
         [x, y - 1]
       ] as const;

       for (const [nxCell, nyCell] of neighbors) {
         if (
           nxCell < 0 || nxCell >= width ||
           nyCell < 0 || nyCell >= height
         ) {
           continue;
         }

         const nIdx = nyCell * width + nxCell;
         const nPlateId = plateField[nIdx];
         if (nPlateId === plateId) continue;

         const other = plates[nPlateId];

         const dx = other.centerX - plate.centerX;
         const dy = other.centerY - plate.centerY;
         const len = Math.hypot(dx, dy) || 1;
         const nxNorm = dx / len;
         const nyNorm = dy / len;

         const relVx = other.driftX - plate.driftX;
         const relVy = other.driftY - plate.driftY;
         const relAlongNormal = relVx * nxNorm + relVy * nyNorm;

         if (relAlongNormal < 0) {
           const comp = (plate.compression + other.compression) * -relAlongNormal;
           localCompression += comp;
           localUplift += comp * params.mountainUpliftStrength;
         } else {
           const rift = relAlongNormal;
           localRift += rift * params.riftStrength;
         }
       }

       // Fold noise for ridgelines
       const fold = foldNoise.sample(nx, ny, params.foldingFrequency);
       localUplift *= (0.6 + 0.4 * (fold * 0.5 + 0.5));

       elevation[idx] += localUplift;
       elevation[idx] -= localRift;

       compression[idx] = localCompression;
       uplift[idx] = localUplift;
     }
   }

   // STEP 3 — Detail noise
   for (let y = 0; y < height; y++) {
     const ny = y / (height - 1);
     for (let x = 0; x < width; x++) {
       const nx = x / (width - 1);
       const idx = y * width + x;

       const detail = fbm(
         detailNoise,
         nx,
         ny,
         4,
         0.55,
         2.3,
         4.0
       ); // [-1,1]

       const scaled = detail * 0.25 * params.erosionBias;
       elevation[idx] += scaled;
     }
   }

   // STEP 4 — Craters / volcanic zones for chaotic shards
   if (
     profile === "CHAOTIC_PRIME" ||
     profile === "BROKEN_SHARD" ||
     profile === "ARCANE_DISTORTED"
   ) {
     const craterCount = profile === "BROKEN_SHARD" ? 8 : 4;
     for (let c = 0; c < craterCount; c++) {
       const cx = rng();
       const cy = rng();
       const radius = 0.05 + rng() * 0.1;
       const depth = 0.2 + rng() * 0.4;

       for (let y = 0; y < height; y++) {
         const ny = y / (height - 1);
         for (let x = 0; x < width; x++) {
           const nx = x / (width - 1);
           const idx = y * width + x;

           const dx = nx - cx;
           const dy = ny - cy;
           const dist = Math.hypot(dx, dy);
           if (dist < radius) {
             const t = 1 - dist / radius;
             elevation[idx] -= depth * t * t;
           }
         }
       }
     }
   }

   // STEP 5 — Normalize to [-1, 1]
   let minHeight = Infinity;
   let maxHeight = -Infinity;
   for (let i = 0; i < elevation.length; i++) {
     const v = elevation[i];
     if (v < minHeight) minHeight = v;
     if (v > maxHeight) maxHeight = v;
   }

   const range = maxHeight - minHeight || 1;
   for (let i = 0; i < elevation.length; i++) {
     const norm = ((elevation[i] - minHeight) / range) * 2 - 1;
     elevation[i] = norm;
   }

   const seaLevel = 0.0;

   // STEP 6 — Biome hints
   for (let i = 0; i < elevation.length; i++) {
     const h = elevation[i];
     const u = uplift[i];

     let code: BiomeHintCode;

     if (h < seaLevel - 0.4) {
       code = 0;
     } else if (h < seaLevel + 0.05) {
       code = 1;
     } else if (h < seaLevel + 0.35) {
       code = 2;
     } else if (h < seaLevel + 0.65) {
       code = 3;
     } else {
       code = 4;
     }

     if (Math.abs(u) > 0.6 && h > seaLevel + 0.2) {
       code = 5;
     }

     biomeHints[i] = code;
   }

   const metadata: LandformMetadata = {
     seaLevel,
     minHeight: -1,
     maxHeight: 1,
     plateCount,
     continentCount
   };

   const tectonics: TectonicField = {
     plateId: plateField,
     compression,
     uplift
   };

   logger?.info(
     `[${this.name}] Landforms generated`,
     {
       shardId,
       plateCount,
       continentCount,
       minHeight,
       maxHeight
     }
   );

   return {
     shardId,
     width,
     height,
     elevation,
     tectonics,
     biomeHints,
     metadata
   };
 }
}

//////////////////////////
// Helper Functions
//////////////////////////

/**
* Wraps a LandformResult into a blueprint-ready structure.
* WorldBlueprint.ts (or similar) can embed this directly.
*/
export function toLandformBlueprint(result: LandformResult): LandformBlueprint {
 return {
   shardId: result.shardId,
   width: result.width,
   height: result.height,
   seaLevel: result.metadata.seaLevel,
   minHeight: result.metadata.minHeight,
   maxHeight: result.metadata.maxHeight,
   elevation: result.elevation,
   biomeHints: result.biomeHints
 };
}

/**
* Bilinear sampling of the elevation field in normalized [0,1] space.
* Useful for client-side interpolation and navigation.
*/
export function sampleElevationBilinear(
 result: LandformResult,
 xNorm: number,
 yNorm: number
): number {
 const { width, height, elevation } = result;
 const x = xNorm * (width - 1);
 const y = yNorm * (height - 1);

 const x0 = Math.floor(x);
 const y0 = Math.floor(y);
 const x1 = Math.min(x0 + 1, width - 1);
 const y1 = Math.min(y0 + 1, height - 1);

 const tx = x - x0;
 const ty = y - y0;

 const idx00 = y0 * width + x0;
 const idx10 = y0 * width + x1;
 const idx01 = y1 * width + x0;
 const idx11 = y1 * width + x1;

 const v00 = elevation[idx00];
 const v10 = elevation[idx10];
 const v01 = elevation[idx01];
 const v11 = elevation[idx11];

 const ix0 = lerp(v00, v10, tx);
 const ix1 = lerp(v01, v11, tx);

 return lerp(ix0, ix1, ty);
}

/**
* Extracts a square chunk of the elevation field into a new Float32Array.
* Coordinates are in cell indices, NOT normalized.
*
* This is handy for TerrainStreamHandler → Godot height tiles.
*/
export function extractElevationChunk(
 result: LandformResult,
 originX: number,
 originY: number,
 size: number
): Float32Array {
 const { width, height, elevation } = result;
 const out = new Float32Array(size * size);

 for (let y = 0; y < size; y++) {
   const srcY = Math.min(originY + y, height - 1);
   for (let x = 0; x < size; x++) {
     const srcX = Math.min(originX + x, width - 1);
     const srcIdx = srcY * width + srcX;
     const dstIdx = y * size + x;
     out[dstIdx] = elevation[srcIdx];
   }
 }

 return out;
}
