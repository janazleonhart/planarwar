// worldcore/ai/brains/AggressiveBrain.ts

import { type NpcDecisionAttackEntity } from "../NpcBrainTypes";
import { type BehaviorContext } from "./BehaviorContext";

export function decideAggressiveBehavior(
  ctx: BehaviorContext,
): NpcDecisionAttackEntity | null {
  const { cooldownMs, players, attackCooldownMs, setCooldownMs } = ctx;

  if (cooldownMs > 0) {
    return null;
  }

  const target = players[0];
  if (!target) {
    setCooldownMs(0);
    return null;
  }

  const decision: NpcDecisionAttackEntity = {
    kind: "attack_entity",
    targetEntityId: target.entityId,
    attackStyle: "melee",
  };

  setCooldownMs(attackCooldownMs);

  return decision;
}
