// worldcore/progression/ProgressEvents.ts

export type ProgressEventKind =
  | "kill"
  | "gather"       // all gathering professions
  | "collect_item"
  | "craft"
  | "use_item"
  | "talk_to"
  | "enter_region"
  | "flag";        // generic flag set / story beat

export type GatheringKind =
  | "mining"
  | "herbalism"
  | "skinning"
  | "fishing"
  | "farming"
  | "quarrying"
  | "logging";     // stub for future woodcutting, etc.

export interface GatheringStats {
   nodesGathered: number;
   // later: skillLevel, xp, rareFinds, etc.
  }

export interface ProgressEventBase {
  kind: ProgressEventKind;
  accountId: string;
  charId: string;
  shardId: string;
  roomId?: string;
  ts: number;             // Date.now() on server
}

// You can break these out more later; for now one union type is enough.
export type ProgressEvent = ProgressEventBase & {
  payload: {
    // kill
    npcId?: string;

    // gathering
    resourceId?: string;          // e.g. "ore_vein_small", "herb_peacebloom_node"
    gatheringKind?: GatheringKind;
    amount?: number;              // nodes/uses, usually 1

    // collect / use / craft
    itemId?: string;
    count?: number;

    // talk / flag
    npcTalkToId?: string;
    flagName?: string;
    flagValue?: string | number | boolean;

    // future-safe: extra metadata
    [key: string]: unknown;
  };
};
