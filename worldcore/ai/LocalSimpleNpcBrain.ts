// worldcore/ai/LocalSimpleNpcBrain.ts

import {
  NpcBrain,
  NpcPerception,
  NpcDecision,
  NpcDecisionAttackEntity,
} from "./NpcBrainTypes";

/**
 * Very simple in-process NPC brain:
 *
 * - If not hostile → do nothing
 * - If no players → do nothing
 * - If on cooldown → do nothing
 * - Else: attack the first player in the room
 */
export class LocalSimpleAggroBrain implements NpcBrain {
  private readonly attackCooldownMs: number;
  private readonly cooldowns = new Map<string, number>();

  constructor(attackCooldownMs: number = 2000) {
    this.attackCooldownMs = attackCooldownMs;
  }

  decide(perception: NpcPerception, dtMs: number): NpcDecision | null {
    if (!perception.hostile) return null;
    if (!perception.alive || perception.hp <= 0) return null;

    if (!perception.playersInRoom || perception.playersInRoom.length === 0) {
      return null;
    }

    const key = perception.npcId;
    const prev = this.cooldowns.get(key) ?? 0;
    const newCd = Math.max(0, prev - dtMs);

    if (newCd > 0) {
      this.cooldowns.set(key, newCd);
      return null;
    }

    const target = perception.playersInRoom[0];
    if (!target) {
      this.cooldowns.set(key, 0);
      return null;
    }

    const decision: NpcDecisionAttackEntity = {
      kind: "attack_entity",
      targetEntityId: target.entityId,
      attackStyle: "melee",
    };

    this.cooldowns.set(key, this.attackCooldownMs);

    return decision;
  }
}
