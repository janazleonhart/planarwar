import { type NpcDecision } from "../NpcBrainTypes";
import { decideAggressiveBehavior } from "./AggressiveBrain";
import { type BehaviorContext } from "./BehaviorContext";

export function decideGuardBehavior(ctx: BehaviorContext): NpcDecision | null {
  return decideAggressiveBehavior(ctx);
}
