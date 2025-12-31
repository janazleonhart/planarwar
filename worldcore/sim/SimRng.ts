// worldcore/sim/SimRng.ts
// Deterministic RNG for simulation + tests.
// Purpose: repeatable behavior (seeded), so tests are stable.

export class SimRng {
  private state: number;

  constructor(seed: number | string) {
    const s = typeof seed === "string" ? SimRng.hash32(seed) : (seed | 0);
    this.state = s === 0 ? 0x6d2b79f5 : s;
  }

  // Mulberry32
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const out = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return out;
  }

  int(minInclusive: number, maxInclusive: number): number {
    const min = Math.trunc(minInclusive);
    const max = Math.trunc(maxInclusive);
    if (max < min) return min;
    const span = max - min + 1;
    return min + Math.floor(this.next() * span);
  }

  bool(pTrue = 0.5): boolean {
    return this.next() < pTrue;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("SimRng.pick() called with empty array");
    return arr[this.int(0, arr.length - 1)];
  }

  shuffle<T>(arr: readonly T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  static hash32(input: string): number {
    // FNV-1a 32-bit
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h | 0;
  }
}
