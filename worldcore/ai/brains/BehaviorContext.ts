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
