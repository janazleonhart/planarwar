// worldcore/sim/MotherBrainWavePlanner.ts

export type Bounds = { minCx: number; maxCx: number; minCz: number; maxCz: number };

export type BrainSpawn = {
  shardId: string;
  spawnId: string;
  type: string;
  archetype: string;
  protoId: string;
  variantId: string | null;
  x: number;
  y: number;
  z: number;
  regionId: string;
};

export type PlaceSpawnAction = { kind: "place_spawn"; spawn: BrainSpawn };

export type BrainWaveTheme =
  | "goblins"
  | "bandits"
  | "rats"
  | "ore"; // shows personal nodes via NpcSpawnController

export type PlanBrainWaveArgs = {
  shardId: string;

  /**
   * Cell bounds. For convenience, callers may pass a slug string like "-4..4,-4..4".
   * (The canonical type is Bounds; the slug is legacy-friendly for tools.)
   */
  bounds: Bounds | string;

  cellSize: number;
  borderMargin: number;

  seed: string; // deterministic seed
  epoch: number; // changes spawns over time
  theme: BrainWaveTheme;

  count: number; // number of placements to generate
};

export function planBrainWave(args: PlanBrainWaveArgs): PlaceSpawnAction[] {
  const bounds = coerceBounds(args.bounds);

  const cellSize = Math.max(1, Math.floor(args.cellSize));
  const border = clamp(Math.floor(args.borderMargin), 0, Math.floor(cellSize / 2));
  const count = Math.max(0, Math.floor(args.count));

  const rng = mulberry32(hashSeed(`${args.seed}|epoch=${args.epoch}|theme=${args.theme}`));

  const cells: Array<{ cx: number; cz: number }> = [];
  for (let cz = bounds.minCz; cz <= bounds.maxCz; cz++) {
    for (let cx = bounds.minCx; cx <= bounds.maxCx; cx++) {
      cells.push({ cx, cz });
    }
  }

  // Deterministic shuffle
  shuffleInPlace(cells, rng);

  const chosen = cells.slice(0, Math.min(count, cells.length));

  const { type, archetype, protoPool } = themeConfig(args.theme);

  const actions: PlaceSpawnAction[] = [];
  for (let i = 0; i < chosen.length; i++) {
    const { cx, cz } = chosen[i];

    const minX = cx * cellSize + border;
    const maxX = (cx + 1) * cellSize - border;
    const minZ = cz * cellSize + border;
    const maxZ = (cz + 1) * cellSize - border;

    const x = lerp(minX, maxX, rng());
    const z = lerp(minZ, maxZ, rng());

    const protoId = protoPool[Math.floor(rng() * protoPool.length)] ?? protoPool[0];

    // We intentionally embed epoch/theme for wipe/select tools, and cell coords for stability.
    const spawnId = sanitizeId(`brain:${args.epoch}:${args.theme}:${cx}_${cz}:${i}:${protoId}`);
    const regionId = `${args.shardId}:${cx},${cz}`;

    actions.push({
      kind: "place_spawn",
      spawn: {
        shardId: args.shardId,
        spawnId,
        type,
        archetype,
        protoId,
        variantId: null,
        x,
        y: 0,
        z,
        regionId,
      },
    });
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Bounds parsing (slug form: "-4..4,-4..4")
// ---------------------------------------------------------------------------

export function parseBoundsSlug(input: string): Bounds {
  const raw = String(input ?? "").trim();
  const [a, b] = raw.split(",").map((s) => s.trim());

  const [minCx, maxCx] = parseRange(a);
  const [minCz, maxCz] = parseRange(b);

  return { minCx, maxCx, minCz, maxCz };
}

function coerceBounds(b: Bounds | string): Bounds {
  if (typeof b === "string") return parseBoundsSlug(b);
  const x = b as Bounds;
  return {
    minCx: Number.isFinite(x.minCx) ? x.minCx : 0,
    maxCx: Number.isFinite(x.maxCx) ? x.maxCx : (Number.isFinite(x.minCx) ? x.minCx : 0),
    minCz: Number.isFinite(x.minCz) ? x.minCz : 0,
    maxCz: Number.isFinite(x.maxCz) ? x.maxCz : (Number.isFinite(x.minCz) ? x.minCz : 0),
  };
}

function parseRange(s: string): [number, number] {
  const raw = String(s ?? "").trim();
  if (!raw) return [0, 0];

  const [loRaw, hiRaw] = raw.split("..").map((x) => x.trim());
  const lo = parseInt(loRaw || "0", 10);
  const hi = parseInt(hiRaw ?? loRaw ?? "0", 10);
  const a = Number.isFinite(lo) ? lo : 0;
  const b = Number.isFinite(hi) ? hi : a;
  return [Math.min(a, b), Math.max(a, b)];
}

// ---------------------------------------------------------------------------
// Theme config
// ---------------------------------------------------------------------------

function themeConfig(theme: BrainWaveTheme): { type: string; archetype: string; protoPool: string[] } {
  switch (theme) {
    case "goblins":
      return { type: "npc", archetype: "npc", protoPool: ["codex_goblin"] };
    case "bandits":
      return { type: "npc", archetype: "npc", protoPool: ["bandit_caster"] };
    case "rats":
      return { type: "npc", archetype: "npc", protoPool: ["town_rat", "coward_rat", "rat_pack_raider"] };
    case "ore":
      // Personal nodes spawn path: resource proto + type=node/resource works with your NpcSpawnController
      return { type: "resource", archetype: "resource", protoPool: ["ore_iron_hematite"] };
    default:
      return { type: "npc", archetype: "npc", protoPool: ["town_rat"] };
  }
}

// ---------------------------------------------------------------------------
// Deterministic RNG + helpers
// ---------------------------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function sanitizeId(s: string): string {
  // keep ":" for authority prefix readability, but normalize everything else
  return s.replace(/[^a-zA-Z0-9_:]+/g, "_").replace(/^_+|_+$/g, "");
}

function hashSeed(seed: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rnd: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}
