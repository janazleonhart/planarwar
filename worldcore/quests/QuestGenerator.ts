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
      // Generator v0.8: starter talk quest unlocks a deterministic follow-up chain.
      unlocks: [`${prefix}greet_quartermaster_ii`],
    },
  ];

  // Generator invariant: early gameplay + many tests assume Rat Culling exists at tier 1.
  // We always include it (when there is room) to keep the board stable and predictable.
  if (quests.length < maxQuests) {
    const required = jitterInt(rng, 3 + tier * 2, 0, 2);
    quests.push({
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
    });
  }

  // Generator v0.7: Deterministic variety, but only from tier 2+ so tier-1 stays "classic" (tests + onboarding).
  if (tier >= 2 && quests.length < maxQuests) {
    const nodeProtoId = pickResourceNodeProtoId(rng, tier);
    const required = jitterInt(rng, 4 + tier * 3, 0, 3);
    quests.push({
      id: `${prefix}gather_${nodeProtoId}`,
      name: resourceGatherQuestName(nodeProtoId),
      description: resourceGatherQuestDescription(nodeProtoId),
      turninPolicy: "board",
      turninBoardId: townId,
      objectives: [
        {
          kind: "harvest",
          nodeProtoId,
          required,
        },
      ],
      reward: rewardForObjective(rng, "harvest", tier, required, false),
      // Generator v0.8: deterministic follow-up for this node type.
      unlocks: [`${prefix}gather_${nodeProtoId}_ii`],
    });
  }

  // Generator v0.7: Deterministic repeatable turn-in (when enabled), tier 2+ only.
  if (tier >= 2 && includeRepeatables && quests.length < maxQuests) {
    const itemId = pickRepeatableTurninItemId(rng, tier);
    const required = jitterInt(rng, 6 + tier * 4, 0, 4);
    const reward = rewardForObjective(rng, "collect_item", tier, required, true);
    quests.push({
      id: repeatableTurninQuestId(prefix, itemId),
      name: repeatableTurninQuestName(itemId),
      description: repeatableTurninQuestDescription(itemId),
      turninPolicy: "board",
      turninBoardId: townId,
      objectives: [
        {
          kind: "collect_item",
          itemId,
          required,
        },
      ],
      reward,
      repeatable: true,
      maxCompletions: null,
    });
  }


  // Candidate templates (safe ids only).
  const candidates: Array<() => QuestDefinition> = [];


  // Harvest quest (tier 2+).
  // Kept for back-compat intent; now rotates the node type deterministically for variety.
  if (tier >= 2) {
    candidates.push(() => {
      const nodeProtoId = pickResourceNodeProtoId(rng, tier);
      const required = jitterInt(rng, 6 + tier * 4, 0, 4);
      return {
        id: `${prefix}resource_sampling_${nodeProtoId}`,
        name: "Resource Sampling",
        description: "Gather resource samples from nearby nodes.",
        turninPolicy: "board",
        turninBoardId: townId,
        objectives: [
          {
            kind: "harvest",
            nodeProtoId,
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
        // Generator v0.8: crafted quest unlocks a deterministic follow-up.
        unlocks: [`${prefix}alchemist_aid_ii`],
      };
    });
  }

  // Repeatable item turn-in quest (safe + stable).
  // (Kept as an optional extra; the deterministic repeatable is added earlier if there's room.)
  // Tier 2+ only: tier-1 onboarding + tests expect no repeatable turn-ins to appear as available.
  if (tier >= 2 && includeRepeatables) {
    candidates.push(() => {
      const itemId = pickRepeatableTurninItemId(rng, tier);
      const required = jitterInt(rng, 6 + tier * 4, 0, 4);
      const reward = rewardForObjective(rng, "collect_item", tier, required, true);
      return {
        id: repeatableTurninQuestId(prefix, itemId),
        name: repeatableTurninQuestName(itemId),
        description: repeatableTurninQuestDescription(itemId),
        turninPolicy: "board",
        turninBoardId: townId,
        objectives: [
          {
            kind: "collect_item",
            itemId,
            required,
          },
        ],
        reward,
        repeatable: true,
        maxCompletions: null,
      };
    });
  }


  // Compound quests (Generator v0.6): multi-objective quests increase variety without expanding id pools.
  // These remain deterministic and use only safe proto/item ids.
  if (tier >= 2) {
    candidates.push(() => {
      const killReq = jitterInt(rng, 4 + tier * 2, 0, 2);
      const collectReq = Math.max(2, Math.floor(killReq / 2));
      const r1 = rewardForObjective(rng, "kill", tier, killReq, false);
      const r2 = rewardForObjective(rng, "collect_item", tier, collectReq, false);
      const reward = rewardForCompound(rng, mergeRewards(r1, r2), 0.9);
      return {
        id: `${prefix}pest_control_supplies`,
        name: "Pest Control Supplies",
        description: "Cull the rats and bring back a few tails as proof for the quartermaster.",
        turninPolicy: "board",
        turninBoardId: townId,
        objectives: [
          { kind: "kill", targetProtoId: "town_rat", required: killReq },
          { kind: "collect_item", itemId: "rat_tail", required: collectReq },
        ],
        reward,
      };
    });
  }

  if (tier >= 2) {
    candidates.push(() => {
      const harvestReq = jitterInt(rng, 5 + tier * 3, 0, 3);
      const nodeProtoId = pickResourceNodeProtoId(rng, tier);
      const r1 = rewardForObjective(rng, "harvest", tier, harvestReq, false);
      const r2 = rewardForObjective(rng, "talk_to", tier, 1, false);
      const reward = rewardForCompound(rng, mergeRewards(r1, r2), 0.9);
      return {
        id: `${prefix}vein_report_${nodeProtoId}`,
        name: "Vein Report",
        description: "Gather ore samples and report your findings to the quartermaster.",
        turninPolicy: "board",
        turninBoardId: townId,
        objectives: [
          { kind: "harvest", nodeProtoId, required: harvestReq },
          { kind: "talk_to", npcId: "npc_quartermaster", required: 1 },
        ],
        reward,
      };
    });
  }

  // Generator v0.7: additional compound template: harvest + collect of the same resource.
  // This leverages the inventory loop: gather nodes, then turn in the resulting items.
  if (tier >= 2) {
    candidates.push(() => {
      const itemId = pickRepeatableTurninItemId(rng, tier);
      const harvestReq = jitterInt(rng, 4 + tier * 2, 0, 2);
      const nodeProtoId = pickResourceNodeProtoId(rng, tier);
      const collectReq = Math.max(2, Math.floor(harvestReq * 0.75));

      const r1 = rewardForObjective(rng, "harvest", tier, harvestReq, false);
      const r2 = rewardForObjective(rng, "collect_item", tier, collectReq, false);
      const reward = rewardForCompound(rng, mergeRewards(r1, r2), 0.88);

      return {
        id: `${prefix}gather_and_deliver_${itemId}`,
        name: `Gather and Deliver (${prettyResourceName(itemId)})`,
        description: `Harvest nearby nodes and deliver ${prettyResourceName(itemId)} to the board as proof of work.`,
        turninPolicy: "board",
        turninBoardId: townId,
        objectives: [
          { kind: "harvest", nodeProtoId: nodeProtoIdForDeliverItem(itemId), required: harvestReq },
          { kind: "collect_item", itemId, required: collectReq },
        ],
        reward,
      };
    });
  }


// ----------------------------
// Fill remaining slots (dedupe-safe / underfill-safe)
// ----------------------------
// Some tiers intentionally have *no* extra candidates (e.g., tier 1). In that case we allow underfill.
// For tiers with candidates, we retry generation to avoid duplicate quest IDs and avoid crashing when the
// candidate list is empty.
const seenIds = new Set<string>(quests.map((q) => q.id));

if (candidates.length > 0) {
  const shuffled = shuffleStable(candidates.slice(), rng);

  // Bounded retry loop to prevent infinite loops if pools are tiny and we keep colliding.
  const maxAttempts = Math.max(50, maxQuests * 40);
  let idx = 0;

  for (let attempts = 0; quests.length < maxQuests && attempts < maxAttempts; attempts++) {
    const mk = shuffled[idx % shuffled.length];
    idx++;

    const q = mk();

    if (seenIds.has(q.id))
      continue;

    seenIds.add(q.id);
    quests.push(q);
  }
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
    // Quartermaster follow-up chain.
    const greetId = `${prefix}greet_quartermaster`;
    quests.push({
      id: `${prefix}greet_quartermaster_ii`,
      name: "Quartermaster's Orders",
      description: "Now that you're signed in, complete a small task to prove your reliability.",
      turninPolicy: "board",
      turninBoardId: townId,
      requiresTurnedIn: [greetId],
      objectives: [
        {
          kind: "kill",
          targetProtoId: "town_rat",
          required: jitterInt(rng, 2 + tier * 2, 0, 2),
        },
      ],
      reward: rewardForObjective(rng, "kill", tier, 4 + tier * 2, false),
    });

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

    // Generator v0.8: deterministic gather follow-up chain for tier 2+.
    // We include a small set of follow-ups across the resource pool so that
    // any accepted/generated state id can be resolved later.
    for (const nodeProtoId of RESOURCE_NODE_POOL) {
      const baseId = `${prefix}gather_${nodeProtoId}`;
      quests.push({
        id: `${prefix}gather_${nodeProtoId}_ii`,
        name: `${resourceGatherQuestName(nodeProtoId)} II`,
        description: `The quartermaster wants more ${prettyResourceName(nodeProtoId)} samples for a full report.`,
        turninPolicy: "board",
        turninBoardId: townId,
        requiresTurnedIn: [baseId],
        objectives: [
          {
            kind: "harvest",
            nodeProtoId,
            required: jitterInt(rng, 6 + tier * 4, 0, 4),
          },
        ],
        reward: rewardForObjective(rng, "harvest", tier, 8 + tier * 4, false),
      });
    }

    // Generator v0.8: deterministic craft follow-up chain for tier 3+.
    quests.push({
      id: `${prefix}alchemist_aid_ii`,
      name: "Alchemist's Aid II",
      description: "Your draught helped. Brew another batch with extra care.",
      turninPolicy: "board",
      turninBoardId: townId,
      requiresTurnedIn: [`${prefix}alchemist_aid`],
      objectives: [
        {
          kind: "craft",
          actionId: "craft:brew_minor_heal",
          required: 1,
        },
      ],
      reward: rewardForObjective(rng, "craft", tier, 1, false),
    });


    // Also include canonical repeatable definitions in the catalog so turned-in quest states can be rendered
    // even if repeatables are not part of the current offering (tier-1 and/or includeRepeatables=false).
    const ratTailId = repeatableTurninQuestId(prefix, "rat_tail");
    quests.push({
      id: ratTailId,
      name: repeatableTurninQuestName("rat_tail"),
      description: repeatableTurninQuestDescription("rat_tail"),
      turninPolicy: "board",
      turninBoardId: townId,
      objectives: [
        {
          kind: "collect_item",
          itemId: "rat_tail",
          required: jitterInt(rng, 8 + tier * 3, 0, 3),
        },
      ],
      reward: rewardForObjective(rng, "collect_item", tier, 10 + tier * 3, true),
      repeatable: true,
      maxCompletions: null,
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

// Generator v0.7 resource pools.
// These ids are already present in core content (NpcTypes/ItemCatalog) and are used elsewhere in tests.
const RESOURCE_NODE_POOL: string[] = [
  // existing node used by early examples
  "ore_vein_small",
  // starter resource node prototypes
  "herb_peacebloom",
  "wood_oak",
  "stone_granite",
  "grain_wheat",
  "fish_river_trout",
  "mana_spark_arcane",
];

const REPEATABLE_TURNIN_ITEM_POOL: string[] = [
  "rat_tail",
  "herb_peacebloom",
  "wood_oak",
  "ore_iron_hematite",
  "stone_granite",
  "grain_wheat",
  "fish_river_trout",
  "mana_spark_arcane",
];

function pickResourceNodeProtoId(rng: () => number, tier: number): string {
  // As tier climbs, broaden the pool by permitting more indices.
  const maxIdx = clampInt(1 + Math.floor(tier / 2), 1, RESOURCE_NODE_POOL.length);
  return RESOURCE_NODE_POOL[randInt(rng, 0, maxIdx - 1)] ?? "ore_vein_small";
}

function pickRepeatableTurninItemId(rng: () => number, tier: number): string {
  const maxIdx = clampInt(2 + Math.floor(tier / 2), 2, REPEATABLE_TURNIN_ITEM_POOL.length);
  return REPEATABLE_TURNIN_ITEM_POOL[randInt(rng, 0, maxIdx - 1)] ?? "rat_tail";
}

function nodeProtoIdForDeliverItem(itemId: string): string {
  // Most starter resources use the same id for node prototype and item.
  // Ore is the exception: the node proto is "ore_vein_small" while the item is "ore_iron_hematite".
  if (itemId === "ore_iron_hematite") return "ore_vein_small";
  return itemId;
}

function prettyResourceName(id: string): string {
  // A tiny humanizer; we don't have to hit the ItemCatalog for UX.
  return String(id)
    .replace(/^npc_/, "")
    .replace(/^ore_/, "Ore ")
    .replace(/^herb_/, "Herb ")
    .replace(/^wood_/, "Wood ")
    .replace(/^grain_/, "Grain ")
    .replace(/^fish_/, "Fish ")
    .replace(/^mana_/, "Mana ")
    .replace(/^stone_/, "Stone ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resourceGatherQuestName(nodeProtoId: string): string {
  if (nodeProtoId === "ore_vein_small") return "Ore Sampling";
  return `Gather ${prettyResourceName(nodeProtoId)}`;
}

function resourceGatherQuestDescription(nodeProtoId: string): string {
  if (nodeProtoId === "ore_vein_small") return "Gather hematite ore samples from nearby veins.";
  return `Gather ${prettyResourceName(nodeProtoId)} from nearby nodes.`;
}

function repeatableTurninQuestName(itemId: string): string {
  if (itemId === "rat_tail") return "Rat Tail Collection";
  return `${prettyResourceName(itemId)} Turn-in`;
}

function repeatableTurninQuestDescription(itemId: string): string {
  if (itemId === "rat_tail") return "A local alchemist is paying for rat tails for their experiments.";
  return `A local buyer is paying for ${prettyResourceName(itemId)}. Deliver them to the board.`;
}


function repeatableTurninQuestId(prefix: string, itemId: string): string {
  // Back-compat: many tests and older quest-state seeders refer to the canonical rat tail repeatable id.
  // Keep it stable forever to avoid breaking "turned-in" resolution.
  if (itemId === "rat_tail") return `${prefix}rat_tail_collection`;
  return `${prefix}turnin_${itemId}`;
}

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


function rewardForCompound(rng: () => number, base: QuestReward | undefined, xpScale: number): QuestReward {
  const b = base ?? { xp: 0 };
  const scaledXp = Math.max(1, Math.floor((b.xp ?? 0) * (Number.isFinite(xpScale) ? xpScale : 1)));
  const xp = jitterInt(rng, scaledXp, -5, 10);

  const reward: QuestReward = { xp };

  const goldBase = Math.max(0, Math.floor(b.gold ?? 0));
  if (goldBase > 0) {
    // Keep compound gold conservative; slight jitter only.
    reward.gold = jitterInt(rng, goldBase, 0, 1);
  }

  if (b.items && b.items.length > 0) reward.items = b.items;
  if (b.titles && b.titles.length > 0) reward.titles = b.titles;
  if ((b as any).chooseOne) (reward as any).chooseOne = (b as any).chooseOne;

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
