// worldcore/quests/QuestGenerator.ts
//
// Quest Generator v0 (town-scoped, deterministic)
//
// Design priorities:
// - Deterministic per (townId, tier, epoch) so it is testable + reproducible.
// - Conservative objective pools: only use ids already present in QuestTypes.ts examples,
//   so generated quests are completable in the current content set.
// - “Epoch variance” is introduced via tiny deterministic jitter on required counts.

import type { QuestDefinition, QuestReward } from "./QuestTypes";

export interface TownQuestGeneratorOptions {
  /** Stable town identifier (spawn id, region id, or any durable key). */
  townId: string;
  /** Town tier (1..N). Values <=0 are clamped to 1. */
  tier: number;
  /** Epoch token that can be rotated (e.g. "2026-W03" or "season_1"). */
  epoch: string;
  /** Max quests to emit (including the always-on intro quest). */
  maxQuests?: number;
  /** Include repeatable item turn-in quests (default true). */
  includeRepeatables?: boolean;
}

/**
 * Stable 32-bit seed for quest generation.
 *
 * NOTE: this is *not* crypto. It's "stable and boring" on purpose.
 */
export function stableQuestGenSeed(input: {
  townId: string;
  tier: number;
  epoch: string;
}): number {
  const t = clampInt(Math.floor(input.tier || 1), 1, 99);
  return hashString32(`${input.townId}|t${t}|${input.epoch}`);
}

export function generateTownQuests(opts: TownQuestGeneratorOptions): QuestDefinition[] {
  const townId = String(opts.townId ?? "").trim();
  if (!townId) return [];

  const tier = clampInt(Math.floor(opts.tier || 1), 1, 99);
  const epoch = String(opts.epoch ?? "").trim() || "epoch:default";

  const includeRepeatables = opts.includeRepeatables !== false;

  // Defaults: tier 1 => 3 quests, tier 2 => 4, tier 3+ => 5 (cap 6).
  const defaultMax = clampInt(2 + Math.min(tier, 4), 3, 6);
  const maxQuests = clampInt(Math.floor(opts.maxQuests ?? defaultMax), 0, 50);
  if (maxQuests <= 0) return [];

  const rng = mulberry32(stableQuestGenSeed({ townId, tier, epoch }));

  const prefix = normalizeTownPrefix(townId, tier);

  // Always include a "starter" talk-to quest.
  const quests: QuestDefinition[] = [
    {
      id: `${prefix}greet_quartermaster`,
      name: "Report to the Quartermaster",
      description: "Check in with the local quartermaster to receive your first orders.",
      objectives: [
        {
          kind: "talk_to",
          npcId: "npc_quartermaster",
          required: 1,
        },
      ],
      reward: { xp: jitterInt(rng, 25 + tier * 10, 0, 10) },
    },
  ];

  // Candidate templates (safe ids only).
  const candidates: Array<() => QuestDefinition> = [];

  // Kill quest (always available).
  candidates.push(() => {
    const required = jitterInt(rng, 3 + tier * 2, 0, 2);
    return {
      id: `${prefix}rat_culling`,
      name: "Rat Culling",
      description: "Help keep the town clean by killing some of the local rats.",
      objectives: [
        {
          kind: "kill",
          targetProtoId: "town_rat",
          required,
        },
      ],
      reward: { xp: jitterInt(rng, 60 + tier * 25, 0, 15) },
    };
  });

  // Harvest quest (tier 2+).
  if (tier >= 2) {
    candidates.push(() => {
      const required = jitterInt(rng, 6 + tier * 4, 0, 4);
      return {
        id: `${prefix}ore_sampling`,
        name: "Ore Sampling",
        description: "Gather hematite ore samples from nearby veins.",
        objectives: [
          {
            kind: "harvest",
            nodeProtoId: "ore_vein_small",
            required,
          },
        ],
        reward: { xp: jitterInt(rng, 80 + tier * 30, 0, 20) },
      };
    });
  }

  // Craft quest (tier 3+).
  if (tier >= 3) {
    candidates.push(() => {
      const required = 1;
      return {
        id: `${prefix}alchemist_aid`,
        name: "Alchemist's Aid",
        description: "Brew a minor healing draught for a local alchemist.",
        objectives: [
          {
            kind: "craft",
            actionId: "craft:brew_minor_heal",
            required,
          },
        ],
        reward: {
          xp: jitterInt(rng, 90 + tier * 35, 0, 25),
          gold: tier >= 4 ? 1 : 0,
        },
      };
    });
  }

  // Repeatable item turn-in quest (safe + stable).
  if (includeRepeatables) {
    candidates.push(() => {
      const required = jitterInt(rng, 6 + tier * 4, 0, 4);
      return {
        id: `${prefix}rat_tail_collection`,
        name: "Rat Tail Collection",
        description: "A local alchemist is paying for rat tails for their experiments.",
        objectives: [
          {
            kind: "collect_item",
            itemId: "rat_tail",
            required,
          },
        ],
        reward: {
          xp: jitterInt(rng, 70 + tier * 25, 0, 20),
          gold: Math.max(1, Math.floor(tier / 2)),
        },
        repeatable: true,
        maxCompletions: null,
      };
    });
  }

  // Deterministic ordering: shuffle candidates, then emit until max.
  const shuffled = shuffleStable(candidates, rng);
  for (const mk of shuffled) {
    if (quests.length >= maxQuests) break;
    quests.push(mk());
  }

  // Sanity: ensure unique ids.
  const seen = new Set<string>();
  const out: QuestDefinition[] = [];
  for (const q of quests) {
    const id = String(q.id ?? "").trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(q);
  }

  return out;
}

// ----------------- helpers -----------------

function normalizeTownPrefix(townId: string, tier: number): string {
  // Keep ids filesystem/URL-friendly.
  const safeTown = String(townId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `town_${safeTown}_t${tier}_`;
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function jitterInt(rng: () => number, base: number, minJitter: number, maxJitter: number): number {
  const j = randInt(rng, minJitter, maxJitter);
  return Math.max(1, Math.floor(base + j));
}

// FNV-1a 32-bit
function hashString32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Convert to uint32
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, maxInclusive: number): number {
  const lo = Math.min(min, maxInclusive);
  const hi = Math.max(min, maxInclusive);
  const r = rng();
  const n = Math.floor(r * (hi - lo + 1)) + lo;
  return clampInt(n, lo, hi);
}

function shuffleStable<T>(arr: T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

// Small helper for future expansions (unused in v0 but handy).
export function mergeRewards(a: QuestReward | undefined, b: QuestReward | undefined): QuestReward | undefined {
  if (!a && !b) return undefined;
  const out: QuestReward = {
    xp: (a?.xp ?? 0) + (b?.xp ?? 0),
    gold: (a?.gold ?? 0) + (b?.gold ?? 0),
    items: [...(a?.items ?? []), ...(b?.items ?? [])],
    titles: [...(a?.titles ?? []), ...(b?.titles ?? [])],
  };

  const hasXp = !!out.xp;
  const hasGold = !!out.gold;
  const hasItems = !!out.items && out.items.length > 0;
  const hasTitles = !!out.titles && out.titles.length > 0;

  return hasXp || hasGold || hasItems || hasTitles ? out : undefined;
}
