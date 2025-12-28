import {
  type NpcDecision,
  type NpcPerception,
  type PerceivedPlayer,
} from "../NpcBrainTypes";

export interface BehaviorContext {
  perception: NpcPerception;
  players: PerceivedPlayer[];
  cooldownMs: number;
  attackCooldownMs: number;
  setCooldownMs: (value: number) => void;
}

export type BehaviorHandler = (ctx: BehaviorContext) => NpcDecision | null;
