// worldcore/world/Boundary.ts

// PLANAR WAR – DomeBoundary (world play-area helper)
//
// This is a modernized version of the old src/world/Boundary.ts fossil.
// It provides a simple "world dome" we can use to:
//  - check if a position is inside the shard
//  - clamp positions back to the edge
//  - compute a soft falloff near the rim (for FX / warnings)

export interface DomeBoundaryState {
    centerX: number;
    centerZ: number;
    radius: number;
    softRadius: number;
  }
  
  export interface ClampResult {
    x: number;
    z: number;
    clamped: boolean;
    distance: number;  // distance from center BEFORE clamping
  }
  
  /**
   * DomeBoundary – circular play-area helper.
   *
   *  radius:      hard cutoff; outside this we clamp.
   *  softRadius:  start of "warning zone" (for FX, UI, etc).
   */
  export class DomeBoundary {
    constructor(
      public centerX: number,
      public centerZ: number,
      public radius: number,
      public softRadius: number
    ) {}
  
    /** Quick check: is this inside the hard dome? */
    isInside(x: number, z: number): boolean {
      const dx = x - this.centerX;
      const dz = z - this.centerZ;
      const distSq = dx * dx + dz * dz;
      return distSq <= this.radius * this.radius;
    }
  
    /**
     * Clamp a position back onto the dome edge if it's outside.
     * Returns the (possibly) adjusted x/z and the original distance.
     */
    clampPosition(x: number, z: number): ClampResult {
      const dx = x - this.centerX;
      const dz = z - this.centerZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
  
      if (dist <= this.radius || dist === 0) {
        // Already inside, or exactly at center.
        return { x, z, clamped: false, distance: dist };
      }
  
      const scale = this.radius / dist;
      const nx = this.centerX + dx * scale;
      const nz = this.centerZ + dz * scale;
  
      return { x: nx, z: nz, clamped: true, distance: dist };
    }
  
    /**
     * Soft falloff factor near the rim.
     *
     *  - 0.0 inside softRadius
     *  - 1.0 at or beyond radius
     *  - smooth 0→1 between softRadius..radius
     *
     * Useful for: fog, warning UI, audio cues, etc.
     */
    falloff(x: number, z: number): number {
      const dx = x - this.centerX;
      const dz = z - this.centerZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
  
      if (dist <= this.softRadius) return 0;
      if (dist >= this.radius) return 1;
  
      const t = (dist - this.softRadius) / (this.radius - this.softRadius);
      // simple smoothstep
      return t * t * (3 - 2 * t);
    }
  
    /** Exportable snapshot (e.g. for debug tools, tests). */
    toState(): DomeBoundaryState {
      return {
        centerX: this.centerX,
        centerZ: this.centerZ,
        radius: this.radius,
        softRadius: this.softRadius,
      };
    }
  
    static fromState(s: DomeBoundaryState): DomeBoundary {
      return new DomeBoundary(s.centerX, s.centerZ, s.radius, s.softRadius);
    }
  }
  