// worldcore/quests/QuestTypes.ts

export type QuestObjectiveKind =
  | "kill"
  | "harvest"
  | "collect_item"
  | "craft"
  | "talk_to"
  | "city";
// later: "go_to", "interact", etc.

export interface QuestObjectiveKill {
  kind: "kill";
  targetProtoId: string;   // e.g. "town_rat"
  required: number;
}

export interface QuestObjectiveHarvest {
  kind: "harvest";
  nodeProtoId: string;     // e.g. "ore_vein_small"
  required: number;
}

export interface QuestObjectiveCollectItem {
  kind: "collect_item";
  itemId: string;          // e.g. "rat_tail"
  required: number;
}

export interface QuestObjectiveCraft {
  kind: "craft";
  actionId: string;        // e.g. "craft:brew_minor_heal"
  required: number;
}

export interface QuestObjectiveCity {
  kind: "city";
  cityActionId: string;    // e.g. "city:build:granary"
  required: number;
}

// NEW: talk_to objective – usually just “do this once”
export interface QuestObjectiveTalkTo {
  kind: "talk_to";
  npcId: string;           // e.g. "trainer_aria" (matches proto id used by Talk)
  required?: number;       // default 1
}

export type QuestObjective =
  | QuestObjectiveKill
  | QuestObjectiveHarvest
  | QuestObjectiveCollectItem
  | QuestObjectiveCraft
  | QuestObjectiveCity
  | QuestObjectiveTalkTo;

export interface QuestReward {
  xp?: number;
  gold?: number;
  items?: { itemId: string; count: number }[];
  titles?: string[];
  /** Rank system v0.2: rewards that GRANT (pending) spells/abilities (not auto-learn). */
  spellGrants?: { spellId: string; source?: string }[];
  abilityGrants?: { abilityId: string; source?: string }[];

  /** Optional: choose ONE of these reward bundles at turn-in. */
  chooseOne?: QuestRewardOption[];
  // later: city-favor, reputation, currencies, etc.
}

export interface QuestRewardOption {
  /** Optional short label shown in reward previews. */
  label?: string;
  xp?: number;
  gold?: number;
  items?: { itemId: string; count: number }[];
  titles?: string[];
  spellGrants?: { spellId: string; source?: string }[];
  abilityGrants?: { abilityId: string; source?: string }[];
}


export interface QuestDefinition {
  id: string;
  name: string;
  description: string;
  objectives: QuestObjective[];
  reward?: QuestReward;

  /**
   * Optional prerequisites: these quest ids must have been turned in at least once
   * before this quest can be accepted.
   */
  requiresTurnedIn?: string[];

  /**
   * Optional follow-up hints: quest ids that become relevant after turning this quest in.
   * (Pure UX for now; the board/service will still decide what to offer.)
   */
  unlocks?: string[];

  // Turn-in policy (Questloop v0.2)
  /** Default: "anywhere" (legacy). */
  turninPolicy?: "anywhere" | "board" | "npc";
  /** When turninPolicy === "npc", the proto id required to be present in the player's room. */
  turninNpcId?: string | null;
  /** When turninPolicy === "board", optional town/region id required for turn-in (generated quests set this). */
  turninBoardId?: string | null;

  // NEW
  /**
   * If true, this quest can be turned in multiple times.
   * Item-collection quests are the safest repeatable type right now.
   */
  repeatable?: boolean;

  /**
   * Optional cap on how many times it can be completed.
   * If omitted/null, it can be completed infinitely.
   */
  maxCompletions?: number | null;
}

export const QUESTS: Record<string, QuestDefinition> = {
  rat_culling: {
    id: "rat_culling",
    name: "Rat Culling",
    description:
      "Help keep the town clean by killing some of the local rats.",
    objectives: [
      {
        kind: "kill",
        targetProtoId: "town_rat",
        required: 5,
      },
    ],
    reward: {
      xp: 100,
    },
  },

  ore_sampling: {
    id: "ore_sampling",
    name: "Ore Sampling",
    description: "Gather hematite ore samples from nearby veins.",
    objectives: [
      {
        kind: "harvest",
        nodeProtoId: "ore_vein_small",
        required: 10,
      },
    ],
    reward: {
      xp: 120,
    },
  },

  // Example item-collection quest; not wired to any NPC yet but supported.
  rat_tail_collection: {
    id: "rat_tail_collection",
    name: "Rat Tail Collection",
    description:
      "A local alchemist is paying for rat tails for their experiments.",
    objectives: [
      {
        kind: "collect_item",
        itemId: "rat_tail",
        required: 10,
      },
    ],
    reward: {
      xp: 150,
      gold: 5,
    },
    repeatable: true,
    maxCompletions: null, // or a number if you want to cap it
  },

  
  // Reward-choice contract quest (exercise choose-one rewards)
  reward_choice_test: {
    id: "reward_choice_test",
    name: "Reward Choice Test",
    description: "A simple quest that requires choosing one reward bundle at turn-in.",
    objectives: [
      {
        kind: "kill",
        targetProtoId: "training_dummy",
        required: 1,
      },
    ],
    reward: {
      chooseOne: [
        { label: "Gold", gold: 5 },
        { label: "Title", titles: ["tester"] },
      ],
    },
  },

greet_quartermaster: {
    id: "greet_quartermaster",
    name: "Report to the Quartermaster",
    description: "Check in with the local quartermaster to receive your first orders.",
    objectives: [
      {
        kind: "talk_to",
        npcId: "npc_quartermaster",
        required: 1,
      },
    ],
    reward: {
      xp: 50,
    },
  },

  // Simple chain example (prereq gating).
  chain_intro_test: {
    id: "chain_intro_test",
    name: "Chain Intro Test",
    description: "A tiny quest used to verify prerequisite gating in the quest system.",
    objectives: [
      {
        kind: "kill",
        targetProtoId: "training_dummy",
        required: 1,
      },
    ],
    reward: {
      xp: 1,
    },
    unlocks: ["chain_followup_test"],
  },

  chain_followup_test: {
    id: "chain_followup_test",
    name: "Chain Follow-up Test",
    description: "A follow-up quest that is locked until Chain Intro Test is turned in.",
    requiresTurnedIn: ["chain_intro_test"],
    objectives: [
      {
        kind: "kill",
        targetProtoId: "training_dummy",
        required: 1,
      },
    ],
    reward: {
      xp: 1,
    },
  },

  // Chain density v0.16 contract kit: unlocks multiple follow-ups at once.
  // Used to ensure the quest board staggers NEW follow-ups instead of flooding the list.
  chain_intro_multi_test: {
    id: "chain_intro_multi_test",
    name: "Chain Intro Multi Test",
    description: "A tiny quest that unlocks multiple follow-ups to test board staggering.",
    objectives: [
      {
        kind: "kill",
        targetProtoId: "training_dummy",
        required: 1,
      },
    ],
    reward: {
      xp: 1,
    },
    unlocks: [
      "chain_followup_multi_a",
      "chain_followup_multi_b",
      "chain_followup_multi_c",
      "chain_followup_multi_d",
      "chain_followup_multi_e",
    ],
  },

  chain_followup_multi_a: {
    id: "chain_followup_multi_a",
    name: "Chain Follow-up Multi A",
    description: "Follow-up A (density test).",
    requiresTurnedIn: ["chain_intro_multi_test"],
    objectives: [{ kind: "kill", targetProtoId: "training_dummy", required: 1 }],
    reward: { xp: 1 },
  },

  chain_followup_multi_b: {
    id: "chain_followup_multi_b",
    name: "Chain Follow-up Multi B",
    description: "Follow-up B (density test).",
    requiresTurnedIn: ["chain_intro_multi_test"],
    objectives: [{ kind: "kill", targetProtoId: "training_dummy", required: 1 }],
    reward: { xp: 1 },
  },

  chain_followup_multi_c: {
    id: "chain_followup_multi_c",
    name: "Chain Follow-up Multi C",
    description: "Follow-up C (density test).",
    requiresTurnedIn: ["chain_intro_multi_test"],
    objectives: [{ kind: "kill", targetProtoId: "training_dummy", required: 1 }],
    reward: { xp: 1 },
  },

  chain_followup_multi_d: {
    id: "chain_followup_multi_d",
    name: "Chain Follow-up Multi D",
    description: "Follow-up D (density test).",
    requiresTurnedIn: ["chain_intro_multi_test"],
    objectives: [{ kind: "kill", targetProtoId: "training_dummy", required: 1 }],
    reward: { xp: 1 },
  },

  chain_followup_multi_e: {
    id: "chain_followup_multi_e",
    name: "Chain Follow-up Multi E",
    description: "Follow-up E (density test).",
    requiresTurnedIn: ["chain_intro_multi_test"],
    objectives: [{ kind: "kill", targetProtoId: "training_dummy", required: 1 }],
    reward: { xp: 1 },
  },

  // Chain diversity v0.17 contract kit: two different parents unlock multiple follow-ups.
  // Used to ensure the quest board spreads NEW follow-ups across chains first.
  chain_followup_diverse_intro_a: {
    id: "chain_followup_diverse_intro_a",
    name: "Chain Diverse Intro A",
    description: "A tiny quest that unlocks multiple follow-ups (A) to test chain diversity.",
    // Contract-only: keep this kit out of normal board offerings so other contracts remain stable.
    requiresTurnedIn: ["__contract_only_chain_diversity__"],
    objectives: [{ kind: "kill", targetProtoId: "training_dummy", required: 1 }],
    reward: { xp: 1 },
    unlocks: [
      "chain_followup_diverse_a1",
      "chain_followup_diverse_a2",
      "chain_followup_diverse_a3",
    ],
  },
  chain_followup_diverse_intro_b: {
    id: "chain_followup_diverse_intro_b",
    name: "Chain Diverse Intro B",
    description: "A tiny quest that unlocks multiple follow-ups (B) to test chain diversity.",
    // Contract-only: keep this kit out of normal board offerings so other contracts remain stable.
    requiresTurnedIn: ["__contract_only_chain_diversity__"],
    objectives: [{ kind: "kill", targetProtoId: "training_dummy", required: 1 }],
    reward: { xp: 1 },
    unlocks: [
      "chain_followup_diverse_b1",
      "chain_followup_diverse_b2",
      "chain_followup_diverse_b3",
    ],
  },
  chain_followup_diverse_a1: {
    id: "chain_followup_diverse_a1",
    name: "Chain Diverse A1",
    description: "Follow-up A1 (chain diversity test).",
    requiresTurnedIn: ["__contract_only_chain_diversity__", "chain_followup_diverse_intro_a"],
    objectives: [{ kind: "kill", targetProtoId: "training_dummy", required: 1 }],
    reward: { xp: 1 },
  },
  chain_followup_diverse_a2: {
    id: "chain_followup_diverse_a2",
    name: "Chain Diverse A2",
    description: "Follow-up A2 (chain diversity test).",
    requiresTurnedIn: ["__contract_only_chain_diversity__", "chain_followup_diverse_intro_a"],
    objectives: [{ kind: "kill", targetProtoId: "training_dummy", required: 1 }],
    reward: { xp: 1 },
  },
  chain_followup_diverse_a3: {
    id: "chain_followup_diverse_a3",
    name: "Chain Diverse A3",
    description: "Follow-up A3 (chain diversity test).",
    requiresTurnedIn: ["__contract_only_chain_diversity__", "chain_followup_diverse_intro_a"],
    objectives: [{ kind: "kill", targetProtoId: "training_dummy", required: 1 }],
    reward: { xp: 1 },
  },
  chain_followup_diverse_b1: {
    id: "chain_followup_diverse_b1",
    name: "Chain Diverse B1",
    description: "Follow-up B1 (chain diversity test).",
    requiresTurnedIn: ["__contract_only_chain_diversity__", "chain_followup_diverse_intro_b"],
    objectives: [{ kind: "kill", targetProtoId: "training_dummy", required: 1 }],
    reward: { xp: 1 },
  },
  chain_followup_diverse_b2: {
    id: "chain_followup_diverse_b2",
    name: "Chain Diverse B2",
    description: "Follow-up B2 (chain diversity test).",
    requiresTurnedIn: ["__contract_only_chain_diversity__", "chain_followup_diverse_intro_b"],
    objectives: [{ kind: "kill", targetProtoId: "training_dummy", required: 1 }],
    reward: { xp: 1 },
  },
  chain_followup_diverse_b3: {
    id: "chain_followup_diverse_b3",
    name: "Chain Diverse B3",
    description: "Follow-up B3 (chain diversity test).",
    requiresTurnedIn: ["__contract_only_chain_diversity__", "chain_followup_diverse_intro_b"],
    objectives: [{ kind: "kill", targetProtoId: "training_dummy", required: 1 }],
    reward: { xp: 1 },
  },

  // Turn-in policy v0.2 example: board-only turn-in bound to a specific town board.
  // Used by movement/walk-to contract tests to ensure town-entry nudges remain meaningful.
  board_turnin_test: {
    id: "board_turnin_test",
    name: "Board Turn-in Test",
    description: "A tiny quest that can only be turned in at a specific town quest board.",
    objectives: [
      {
        kind: "kill",
        targetProtoId: "training_dummy",
        required: 1,
      },
    ],
    // Restrict turn-in to a board context and bind it to a specific board id.
    // (Test harness uses roomId-derived townId like 'prime_shard:1,0'.)
    turninPolicy: "board" as any,
    turninBoardId: "prime_shard:1,0" as any,
    reward: {
      xp: 1,
    },
  },

  // Rank system v0.2 example: quest reward grants pending spell + ability.
  // Used by contract tests and as a reference kit for content authors.
  trainer_spell_grant_test: {
    id: "trainer_spell_grant_test",
    name: "Trainer's Lesson",
    description: "A trainer offers you a lesson — but you must first speak to them.",
    objectives: [
      {
        kind: "talk_to",
        npcId: "trainer_aria",
        required: 1,
      },
    ],
    reward: {
      xp: 10,
      spellGrants: [{ spellId: "magician_summon_wolf_ii", source: "quest:trainer_spell_grant_test" }],
      abilityGrants: [{ abilityId: "warrior_cleave", source: "quest:trainer_spell_grant_test" }],
    },
  },

};

export function listAllQuests(): QuestDefinition[] {
  return Object.values(QUESTS);
}
