// worldcore/terrain/regions/RegionTypes.ts

/**
 * Unique region identifier. For now it's a simple string like
 * `${worldId}:${cx},${cz}` but we keep the alias for future-proofing.
 */
 export type RegionId = string;

 /**
  * Coarse-grained region used by strategy layer, city builder,
  * and future MMO shard systems.
  */
 export interface Region {
   id: RegionId;
 
   // identity
   worldId: string;
   seed: number;
 
   // spatial (world-space center in X/Z)
   centerX: number;
   centerZ: number;
   radius: number;
 
   // classification
   biome: string;        // e.g. "plains", "forest", "river"
   climateZone?: number; // optional climate bucket (0..N)
 
   // terrain summary
   avgHeight: number;
   avgSlope: number;
 
   // resource summary (future-proofed)
   resourceDensity?: number;
 
   // extensible tags (safe for strategy/cortex)
   tags: string[];
 
   // audit / debug
   generatedAt: number;  // epoch ms
 }
 
 /**
  * Fine-grained sample used by things that care about
  * the exact terrain at some point (e.g. mission generator,
  * AI scouting, MMO shard hooks).
  */
 export interface RegionSample {
   x: number;
   z: number;
   height: number;
   slope: number;
   biome: string;
 }
 