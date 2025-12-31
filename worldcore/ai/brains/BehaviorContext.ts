// worldcore/ai/brains/BehaviorContext.ts

import {
  type NpcDecision,
  type NpcPerception,
  type PerceivedPlayer,
} from "../NpcBrainTypes";

export interface GuardMemory {
  hasWarned: (npcId: string, characterId: string) => boolean;
  markWarned: (npcId: string, characterId: string) => void;

  hasCalledHelp: (npcId: string, characterId: string) => boolean;
  markCalledHelp: (npcId: string, characterId: string) => void;

  /**
   * Optional hook: forget warnings/help for a given guard NPC.
   * Used for "stand down" once no criminals remain.
   */
  clearForNpc?: (npcId: string) => void;
}

export interface BehaviorContext {
  perception: NpcPerception;
  players: PerceivedPlayer[];

  cooldownMs: number;
  attackCooldownMs: number;
  setCooldownMs: (value: number) => void;

  guardMemory?: GuardMemory;
}

export type BehaviorHandler = (ctx: BehaviorContext) => NpcDecision | null;
