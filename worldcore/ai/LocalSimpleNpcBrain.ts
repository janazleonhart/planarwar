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
 * - If not hostile, do nothing.
 * - If no players in room, do nothing.
 * - If on cooldown, do nothing.
 * - Otherwise, pick the first player in the room and attack them.
 *
 * This is intentionally tiny and generic – the actual
 * execution of the decision (damage, aggro, etc.) is
 * handled elsewhere.
 */
export class LocalSimpleAggroBrain implements NpcBrain {
  /**
   * Attack cooldown per NPC, in milliseconds.
   * e.g. 2000ms = try to attack once every 2 seconds.
   */
  private readonly attackCooldownMs: number;

  /**
   * Internal cooldown tracking, by npcId.
   */
  private readonly cooldowns: Map<string, number>;

  constructor(attackCooldownMs: number = 2000) {
    this.attackCooldownMs = attackCooldownMs;
    this.cooldowns = new Map();
  }

  decide(perception: NpcPerception, dtMs: number): NpcDecision | null {
    // Non-hostile NPCs do nothing for now.
    if (!perception.hostile) {
      return null;
    }

    // Dead or zero HP: no decisions.
    if (!perception.alive || perception.hp <= 0) {
      return null;
    }

    // No players in room: nothing to do.
    if (!perception.playersInRoom || perception.playersInRoom.length === 0) {
      return null;
    }

    const npcKey = perception.npcId;

    // Update and check cooldown.
    const prevCd = this.cooldowns.get(npcKey) ?? 0;
    const newCd = Math.max(0, prevCd - dtMs);

    if (newCd > 0) {
      // Still on cooldown: update and bail.
      this.cooldowns.set(npcKey, newCd);
      return null;
    }

    // Off cooldown – pick a target and issue an attack decision.
    const target = perception.playersInRoom[0];
    if (!target) {
      // Shouldn't happen given previous check, but be safe.
      this.cooldowns.set(npcKey, 0);
      return null;
    }

    const decision: NpcDecisionAttackEntity = {
      kind: "attack_entity",
      targetEntityId: target.entityId,
      attackStyle: "melee",
    };

    // Reset cooldown after deciding to attack.
    this.cooldowns.set(npcKey, this.attackCooldownMs);

    return decision;
  }
}
