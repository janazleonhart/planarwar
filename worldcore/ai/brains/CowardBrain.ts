// worldcore/ai/brains/CowardBrain.ts

import { type NpcDecision } from "../NpcBrainTypes";
import { type BehaviorContext } from "./BehaviorContext";

/**
 * Coward behavior v2:
 *
 * - If hurt (hp < maxHp) → emit flee.
 * - If unharmed → NEVER initiate combat.
 *
 * Threat / pack logic is still handled by NpcManager; this brain
 * just refuses to pick an attack target.
 */
export function decideCowardBehavior(
  ctx: BehaviorContext,
): NpcDecision | null {
  const { perception, players } = ctx;

  // Coward has taken damage: flee from whoever last hurt us,
  // or from any visible player as a fallback.
  if (perception.maxHp > 0 && perception.hp < perception.maxHp) {
    const fromEntityId =
      perception.lastAttackerId ?? players[0]?.entityId ?? undefined;

    return {
      kind: "flee",
      fromEntityId,
    };
  }

  // Unharmed cowards do not proactively attack anybody.
  return null;
}
