// worldcore/ai/LocalSimpleNpcBrain.ts

import type { NpcBehavior } from "../npc/NpcTypes";
import type {
  NpcBrain,
  NpcPerception,
  NpcDecision,
} from "./NpcBrainTypes";
import {
  decideAggressiveBehavior,
} from "./brains/AggressiveBrain";
import type { BehaviorHandler } from "./brains/BehaviorContext";
import { decideCowardBehavior } from "./brains/CowardBrain";
import { decideGuardBehavior } from "./brains/GuardBrain";
import { decideNeutralBehavior } from "./brains/NeutralBrain";

const DEFAULT_COOLDOWN_MS = 2000;

/**
 * Very simple in-process NPC brain:
 *
 * - If not hostile → does nothing
 * - If no players → does nothing
 * - Behavior is delegated to per-profile brains (aggressive/guard/coward/neutral)
 * - Cooldowns are tracked per-NPC
 */
export class LocalSimpleAggroBrain implements NpcBrain {
  private readonly attackCooldownMs: number;

  private readonly cooldowns = new Map<string, number>();
  private readonly guardWarnings = new Map<string, Set<string>>();
  private readonly guardHelpCalls = new Map<string, Set<string>>();

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

  // --- Guard memory helpers -------------------------------------------------

  private getWarnedSet(npcId: string): Set<string> {
    let set = this.guardWarnings.get(npcId);
    if (!set) {
      set = new Set<string>();
      this.guardWarnings.set(npcId, set);
    }
    return set;
  }

  private getHelpSet(npcId: string): Set<string> {
    let set = this.guardHelpCalls.get(npcId);
    if (!set) {
      set = new Set<string>();
      this.guardHelpCalls.set(npcId, set);
    }
    return set;
  }

  hasWarnedTarget(npcId: string, characterId: string): boolean {
    return this.guardWarnings.get(npcId)?.has(characterId) ?? false;
  }

  markWarnedTarget(npcId: string, characterId: string): void {
    this.getWarnedSet(npcId).add(characterId);
  }

  hasCalledHelp(npcId: string, characterId: string): boolean {
    return this.guardHelpCalls.get(npcId)?.has(characterId) ?? false;
  }

  markCalledHelp(npcId: string, characterId: string): void {
    this.getHelpSet(npcId).add(characterId);
  }

  /**
   * Clear all guard memory (warnings/help) for a specific guard NPC.
   * Used when the guard "stands down" after no criminals remain.
   */
  clearGuardMemoryForNpc(npcId: string): void {
    this.guardWarnings.delete(npcId);
    this.guardHelpCalls.delete(npcId);
  }

  // --- Core brain dispatch --------------------------------------------------

  decide(perception: NpcPerception, dtMs: number): NpcDecision | null {
    const npcKey = perception.npcId;

    // Update cooldown
    const prevCd = this.cooldowns.get(npcKey) ?? 0;
    const newCd = Math.max(0, prevCd - dtMs);
    this.cooldowns.set(npcKey, newCd);

    const behavior = (perception.behavior ?? "aggressive") as NpcBehavior;
    const isGuard = behavior === "guard";

    // Dead / non-hostile (except guards, which still react to crime) → nothing
    if (!perception.alive || (!perception.hostile && !isGuard)) {
      return null;
    }

    const players = perception.playersInRoom ?? [];
    if (players.length === 0) {
      return null;
    }

    const handler =
      this.behaviorHandlers[behavior] ?? decideAggressiveBehavior;

    return handler({
      perception,
      players,
      cooldownMs: newCd,
      attackCooldownMs: this.attackCooldownMs,
      setCooldownMs: (value: number) => this.cooldowns.set(npcKey, value),
      guardMemory: {
        hasWarned: (npcId, characterId) =>
          this.hasWarnedTarget(npcId, characterId),
        markWarned: (npcId, characterId) =>
          this.markWarnedTarget(npcId, characterId),
        hasCalledHelp: (npcId, characterId) =>
          this.hasCalledHelp(npcId, characterId),
        markCalledHelp: (npcId, characterId) =>
          this.markCalledHelp(npcId, characterId),
        clearForNpc: (npcId) => this.clearGuardMemoryForNpc(npcId),
      },
    });
  }
}
