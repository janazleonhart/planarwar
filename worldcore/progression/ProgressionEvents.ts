// worldcore/progression/ProgressionEvents.ts

// High-level event kinds the progression/quest system understands.
export type ProgressEventKind =
  | "kill_npc"
  | "harvest_node"
  | "item_turnin"
  | "talk_to_npc"
  | "visit_room";

// A single progression event instance.
export interface ProgressEvent {
  kind: ProgressEventKind;

  /**
   * Canonical target ids:
   * - kill_npc: npc proto id (e.g. "town_rat")
   * - harvest_node: npc proto id for resource node (e.g. "ore_vein_small")
   * - item_turnin: item id (e.g. "rat_tail")
   * - talk_to_npc: npc proto id (e.g. "quest_giver_1")
   * - visit_room: room id / shard+room key
   */
  targetId?: string;

  /**
   * How many "ticks" of progress this event represents.
   * For kills/harvests/turnins this is normally 1, but we keep it flexible.
   */
  amount?: number;
}
