//worldcore/utils/Rng.ts

export class Rng {
  private _state: number;

  constructor(seed: string | number) {
    if (typeof seed === "number") {
      this._state = (seed >>> 0) || 1;
    } else {
      this._state = Rng.hashString(seed);
    }
  }

  private static hashString(str: string): number {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return (h >>> 0) || 1;
  }

  // mulberry32-style
  next(): number {
    let t = (this._state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    const n = this.next();
    return min + Math.floor(n * (maxInclusive - min + 1));
  }

  pick<T>(list: T[]): T {
    if (!list.length) {
      throw new Error("Rng.pick called with empty list");
    }
    const idx = this.int(0, list.length - 1);
    return list[idx];
  }
}
