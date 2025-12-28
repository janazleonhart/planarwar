// worldcore/ai/LocalSimpleNpcBrain.ts

import { type NpcBehavior } from "../npc/NpcTypes";
import {
  type NpcBrain,
  type NpcPerception,
  type NpcDecision,
} from "./NpcBrainTypes";
import {
  decideAggressiveBehavior,
} from "./brains/AggressiveBrain";
import { type BehaviorHandler } from "./brains/BehaviorContext";
import { decideCowardBehavior } from "./brains/CowardBrain";
import { decideGuardBehavior } from "./brains/GuardBrain";
import { decideNeutralBehavior } from "./brains/NeutralBrain";

const DEFAULT_COOLDOWN_MS = 2000;

/**
 * Very simple in-process NPC brain:
 *
 * - If not hostile → does nothing
 * - If no players → does nothing
 * - If behavior === "coward" and HP < maxHP → emits flee
 * - Otherwise: attack the first player in the room on cooldown
 */
export class LocalSimpleAggroBrain implements NpcBrain {
  private readonly attackCooldownMs: number;
  private readonly cooldowns = new Map<string, number>();

  private readonly behaviorHandlers: Partial<
    Record<NpcBehavior, BehaviorHandler>
  > = {
    aggressive: decideAggressiveBehavior,
    guard: decideGuardBehavior,
    coward: decideCowardBehavior,
    neutral: decideNeutralBehavior,
    testing: decideAggressiveBehavior,
  };

  constructor(attackCooldownMs: number = DEFAULT_COOLDOWN_MS) {
    this.attackCooldownMs = attackCooldownMs;
  }

  decide(perception: NpcPerception, dtMs: number): NpcDecision | null {
    const npcKey = perception.npcId;

    // Update cooldown
    const prevCd = this.cooldowns.get(npcKey) ?? 0;
    const newCd = Math.max(0, prevCd - dtMs);
    this.cooldowns.set(npcKey, newCd);

    // Dead / non-hostile → nothing
    if (!perception.alive || !perception.hostile) {
      return null;
    }

    const players = perception.playersInRoom ?? [];
    if (players.length === 0) {
      return null;
    }

    const behavior = perception.behavior ?? "aggressive";
    const handler =
      this.behaviorHandlers[behavior] ?? decideAggressiveBehavior;

    return handler({
      perception,
      players,
      cooldownMs: newCd,
      attackCooldownMs: this.attackCooldownMs,
      setCooldownMs: (value: number) => this.cooldowns.set(npcKey, value),
    });
  }
}
