// worldcore/ai/brains/CowardBrain.ts

import { type NpcDecision } from "../NpcBrainTypes";
import { decideAggressiveBehavior } from "./AggressiveBrain";
import { type BehaviorContext } from "./BehaviorContext";

export function decideCowardBehavior(
  ctx: BehaviorContext,
): NpcDecision | null {
  const { perception, players } = ctx;

  if (perception.maxHp > 0 && perception.hp < perception.maxHp) {
    return {
      kind: "flee",
      fromEntityId: players[0]?.entityId,
    };
  }

  return decideAggressiveBehavior(ctx);
}
