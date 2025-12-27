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
 * - If "coward" and low HP → try to flee instead of attack
 * - Else: attack the first player in the room on cooldown
 */
export class LocalSimpleAggroBrain implements NpcBrain {
  private readonly attackCooldownMs: number;
  private readonly cooldowns = new Map<string, number>();

  constructor(attackCooldownMs: number = 2000) {
    this.attackCooldownMs = attackCooldownMs;
  }

  decide(perception: NpcPerception, dtMs: number): NpcDecision | null {
    const npcKey = perception.npcId;

    // Update cooldown first so both flee and attack share the same timer.
    const prevCd = this.cooldowns.get(npcKey) ?? 0;
    const newCd = Math.max(0, prevCd - dtMs);
    this.cooldowns.set(npcKey, newCd);

    // Non-hostile NPCs do nothing for now.
    if (!perception.hostile) {
      return null;
    }

    // Dead or zero HP: no decisions.
    if (!perception.alive || perception.hp <= 0) {
      return null;
    }

    if (!perception.playersInRoom || perception.playersInRoom.length === 0) {
      return null;
    }

    const hpFrac =
      perception.maxHp > 0
        ? perception.hp / perception.maxHp
        : 1;

    // --- Coward behavior: try to flee at low HP ---
    if (perception.behavior === "coward" && hpFrac <= 0.3) {
      // Only let the coward brain make a flee decision when off cooldown,
      // so we don't spam flee intents every frame.
      if (newCd > 0) {
        return null;
      }

      const from = perception.playersInRoom[0];
      this.cooldowns.set(npcKey, this.attackCooldownMs);

      return {
        kind: "flee",
        fromEntityId: from?.entityId,
      };
    }

    // --- Aggressive / guard / high-HP coward: standard attack ---
    if (newCd > 0) {
      // Still on cooldown: no decision this tick.
      return null;
    }

    const target = perception.playersInRoom[0];
    if (!target) {
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
