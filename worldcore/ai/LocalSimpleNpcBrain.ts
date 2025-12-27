// worldcore/ai/LocalSimpleNpcBrain.ts

import {
  NpcBrain,
  NpcPerception,
  NpcDecision,
  NpcDecisionAttackEntity,
} from "./NpcBrainTypes";

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

    // Cowards: once hurt at all, they flee instead of attacking.
    if (
      perception.behavior === "coward" &&
      perception.maxHp > 0 &&
      perception.hp < perception.maxHp
    ) {
      return {
        kind: "flee",
        fromEntityId: players[0]?.entityId,
      };
    }

    // If still on cooldown, do nothing this tick
    if (newCd > 0) {
      return null;
    }

    const target = players[0];
    if (!target) {
      this.cooldowns.set(npcKey, 0);
      return null;
    }

    const decision: NpcDecisionAttackEntity = {
      kind: "attack_entity",
      targetEntityId: target.entityId,
      attackStyle: "melee",
    };

    this.cooldowns.set(npcKey, this.attackCooldownMs);

    return decision;
  }
}
