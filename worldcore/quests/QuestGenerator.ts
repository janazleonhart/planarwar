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
  /** Include locked chain follow-ups in the returned catalog (default false). */
  includeChainCatalog?: boolean;
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
      // Town board quests should be turned in at the board for the current town.
      turninPolicy: "board",
      turninBoardId: townId,
      objectives: [
        {
          kind: "talk_to",
          npcId: "npc_quartermaster",
          required: 1,
        },
      ],
      reward: rewardForObjective(rng, "talk_to", tier, 1, false),
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
      turninPolicy: "board",
      turninBoardId: townId,
      objectives: [
        {
          kind: "kill",
          targetProtoId: "town_rat",
          required,
        },
      ],
      reward: rewardForObjective(rng, "kill", tier, required, false),
      unlocks: [`${prefix}rat_culling_ii`],
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
        turninPolicy: "board",
        turninBoardId: townId,
        objectives: [
          {
            kind: "harvest",
            nodeProtoId: "ore_vein_small",
            required,
          },
        ],
        reward: rewardForObjective(rng, "harvest", tier, required, false),
      };
    });
  }

  // Craft quest (tier 3+).
  if (tier >= 3) {
    candidates.push(() => {
      const required = 1;
      const baseReward = rewardForObjective(rng, "craft", tier, required, false);

      // Generator v0.5: higher-tier crafted quests offer a simple choose-one bonus
      // at turn-in. This exercises reward-choice UX without requiring new content ids.
      if (tier >= 4) {
        baseReward.chooseOne = [
          {
            label: "Bonus XP",
            xp: 40 + tier * 15,
          },
          {
            label: "Bonus Gold",
            gold: 3 + Math.floor(tier / 2),
          },
        ];
      }

      return {
        id: `${prefix}alchemist_aid`,
        name: "Alchemist's Aid",
        description: "Brew a minor healing draught for a local alchemist.",
        turninPolicy: "board",
        turninBoardId: townId,
        objectives: [
          {
            kind: "craft",
            actionId: "craft:brew_minor_heal",
            required,
          },
        ],
        reward: baseReward,
      };
    });
  }

  // Repeatable item turn-in quest (safe + stable).
  if (includeRepeatables) {
    candidates.push(() => {
      const required = jitterInt(rng, 6 + tier * 4, 0, 4);
      const reward = rewardForObjective(rng, "collect_item", tier, required, true);
      return {
        id: `${prefix}rat_tail_collection`,
        name: "Rat Tail Collection",
        description: "A local alchemist is paying for rat tails for their experiments.",
        turninPolicy: "board",
        turninBoardId: townId,
        objectives: [
          {
            kind: "collect_item",
            itemId: "rat_tail",
            required,
          },
        ],
        reward,
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


  // ----------------------------
  // Deterministic chain follow-ups (v0.4)
  //
  // Follow-ups are NOT part of the default board offering; they are surfaced
  // via TownQuestBoard's unlocked-followup mechanism once prerequisites are met.
  //
  // When includeChainCatalog=true, we emit the locked follow-up definitions so
  // unlock resolution can fetch them deterministically.
  // ----------------------------
  if (opts.includeChainCatalog) {
    const ratCullingId = `${prefix}rat_culling`;
    const ratCullingFollowId = `${prefix}rat_culling_ii`;

    quests.push({
      id: ratCullingFollowId,
      name: "Rat Culling II",
      description: "The infestation is worse than expected. Cull more rats to keep the town safe.",
      turninPolicy: "board",
      turninBoardId: townId,
      requiresTurnedIn: [ratCullingId],
      objectives: [
        {
          kind: "kill",
          targetProtoId: "town_rat",
          required: jitterInt(rng, 6 + tier * 3, 0, 3),
        },
      ],
      reward: rewardForObjective(rng, "kill", tier, 8 + tier * 3, false),
    });
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

type RewardObjectiveKind = "talk_to" | "kill" | "harvest" | "collect_item" | "craft";

function rewardForObjective(
  rng: () => number,
  kind: RewardObjectiveKind,
  tier: number,
  required: number,
  isRepeatable: boolean
): QuestReward {
  const t = clampInt(Math.floor(tier || 1), 1, 99);
  const req = clampInt(Math.floor(required || 1), 1, 9999);

  // Generator v0.5: consistent scaling by tier + objective size.
  // The jitter is intentionally small so rewards feel stable per epoch.
  let baseXp = 50;
  let baseGold = 0;

  switch (kind) {
    case "talk_to":
      baseXp = 20 + t * 10;
      break;

    case "kill":
      baseXp = 40 + t * 30 + req * 5;
      break;

    case "harvest":
      baseXp = 50 + t * 35 + req * 3;
      break;

    case "collect_item":
      baseXp = 45 + t * 25 + req * 4;
      // Turn-in quests are a natural gold faucet; keep it modest.
      baseGold = Math.max(1, Math.floor(t / 2));
      break;

    case "craft":
      baseXp = 80 + t * 40;
      baseGold = t >= 4 ? 1 + Math.floor(t / 3) : 0;
      break;

    default:
      baseXp = 50 + t * 20;
      break;
  }

  // Repeatables should not outclass unique quests by raw XP.
  if (isRepeatable) {
    baseXp = Math.floor(baseXp * 0.85);
  }

  const xp = jitterInt(rng, baseXp, -5, 10);
  const gold = baseGold > 0 ? jitterInt(rng, baseGold, 0, 1) : 0;

  const reward: QuestReward = { xp };
  if (gold > 0) reward.gold = gold;
  return reward;
}

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
