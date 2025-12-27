// worldcore/terrain/height/Heightmap.ts

/**
 * Minimal, deterministic 2D heightfield with a couple of octave layers.
 * This is intentionally simple but stable so all callers (MMO / webend / tools)
 * get the same terrain for the same seed.
 */
 export class Heightmap {
  private _noiseScale = 1;

  constructor(private readonly seed: number) {}

  setNoiseScale(scale: number) {
    this._noiseScale = Math.max(0.1, scale);
  }

  /**
   * Cheap hash-based 2D noise in [-1, 1].
   */
  private noise2D(x: number, z: number, freq: number, salt: number): number {
    const xi = Math.floor(x * freq);
    const zi = Math.floor(z * freq);

    let n = xi;
    n = Math.imul(n ^ (n >> 16), 0x7feb352d);
    n = Math.imul(n ^ (n >> 15), 0x846ca68b);
    n ^= zi + this.seed * 374761393 + salt;

    // Convert to [0,1], then to [-1,1]
    const v = (n >>> 0) / 0xffffffff;
    return v * 2 - 1;
  }

  /**
   * Base terrain height at (x, z).
   * Optional biome hint lets us tweak shape per biome.
   */
  sample(x: number, z: number, biome?: string): number {
    const baseFreq = 0.004 * this._noiseScale;
    const detailFreq = 0.02 * this._noiseScale;

    const base = this.noise2D(x, z, baseFreq, 101);
    const detail = this.noise2D(x + 1000, z + 1000, detailFreq, 202);

    let height = base * 18 + detail * 4;

    switch (biome) {
      case "plains":
        height *= 0.4;
        break;
      case "farm":
        height *= 0.3;
        break;
      case "road":
        height *= 0.2;
        break;
      case "river":
        height = height * 0.2 - 2;
        break;
      case "hills":
        height *= 1.4;
        break;
      case "cave":
        height -= 5;
        break;
      default:
        // "forest" / anything else: leave as-is for now
        break;
    }

    return height;
  }

  /**
   * Approximate slope magnitude at (x, z).
   */
  sampleSlope(x: number, z: number, biomeHint?: string): number {
    const h = this.sample(x, z, biomeHint);
    const hx = this.sample(x + 1, z, biomeHint);
    const hz = this.sample(x, z + 1, biomeHint);

    const dx = hx - h;
    const dz = hz - h;

    return Math.sqrt(dx * dx + dz * dz);
  }
}
