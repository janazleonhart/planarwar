//worldcore/terrain/regions/RegionSampler.ts

import { Heightmap } from "../height/Heightmap";
import { Region } from "./RegionTypes";

export class RegionSampler {
  constructor(
    private worldId: string,
    private seed: number,
    private heightmap: Heightmap
  ) {}

  sampleRegion(
    cx: number,
    cz: number,
    radius: number
  ): Region {
    const samples = 16;
    let heightSum = 0;
    let slopeSum = 0;

    for (let i = 0; i < samples; i++) {
      const dx = (Math.random() - 0.5) * radius * 2;
      const dz = (Math.random() - 0.5) * radius * 2;

      const x = cx + dx;
      const z = cz + dz;

      heightSum += this.heightmap.sample(x, z);
      slopeSum += this.heightmap.sampleSlope(x, z);
    }

    return {
      id: `region_${Math.floor(cx)}_${Math.floor(cz)}`,
      worldId: this.worldId,
      seed: this.seed,

      centerX: cx,
      centerZ: cz,
      radius,

      biome: "unknown", // resolved later
      avgHeight: heightSum / samples,
      avgSlope: slopeSum / samples,

      tags: [],
      generatedAt: Date.now(),
    };
  }
}
