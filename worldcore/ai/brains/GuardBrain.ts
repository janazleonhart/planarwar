// worldcore/ai/brains/GuardBrain.ts

import {
  type NpcDecision,
  type PerceivedPlayer,
} from "../NpcBrainTypes";
import { decideAggressiveBehavior } from "./AggressiveBrain";
import type { BehaviorContext } from "./BehaviorContext";

/**
 * Priority for which criminals guards prefer to focus:
 * - healer first
 * - then dps
 * - then tank
 * - unknown role last
 */
const ROLE_PRIORITY: Record<
  NonNullable<PerceivedPlayer["combatRole"]> | "unknown",
  number
> = {
  healer: 0,
  dps: 1,
  tank: 2,
  unknown: 3,
};

/**
 * Simple guard tuning knobs.
 *
 * If you ever want guards to be harsher/softer, tweak these constants.
 */
const GUARD_WARN_ON_MINOR_CRIME = true;
const GUARD_WARN_SAFE_HUB_ONLY = true;

/**
 * Pick the best criminal target for a guard:
 * - must have an active crime window (recentCrimeUntil > now)
 * - prioritise role, then lowest HP%
 */
export function pickGuardTarget(
  players: PerceivedPlayer[],
  now: number = Date.now(),
): PerceivedPlayer | undefined {
  const criminals = players.filter(
    (p) => (p.recentCrimeUntil ?? 0) > now,
  );
  if (criminals.length === 0) return undefined;

  return criminals
    .slice()
    .sort((a, b) => {
      const roleA =
        ROLE_PRIORITY[a.combatRole ?? "unknown"] ??
        ROLE_PRIORITY["unknown"];
      const roleB =
        ROLE_PRIORITY[b.combatRole ?? "unknown"] ??
        ROLE_PRIORITY["unknown"];

      if (roleA !== roleB) return roleA - roleB;

      const hpPctA = a.maxHp > 0 ? a.hp / a.maxHp : 0;
      const hpPctB = b.maxHp > 0 ? b.hp / b.maxHp : 0;

      return hpPctA - hpPctB;
    })[0];
}

/**
 * Guard behavior:
 * - If there are no active criminals → stand down and clear memory.
 * - If minor crime in a safe hub and not yet warned → warn once.
 * - Otherwise → mark help-called and attack like an aggressive mob.
 */
export function decideGuardBehavior(ctx: BehaviorContext): NpcDecision | null {
  const { perception, players, guardMemory } = ctx;
  const now = Date.now();

  // Determine if there are *any* criminals at all.
  const criminals = players.filter(
    (p) => (p.recentCrimeUntil ?? 0) > now,
  );

  if (criminals.length === 0) {
    // Stand-down: no criminals left in this room; forget old warnings/help
    guardMemory?.clearForNpc?.(perception.npcId);
    return null;
  }

  const target = pickGuardTarget(players, now);
  if (!target) {
    return null;
  }

  const targetId = target.characterId ?? target.entityId;
  const warned =
    !!targetId &&
    !!guardMemory?.hasWarned &&
    guardMemory.hasWarned(perception.npcId, targetId);

  const severe = target.recentCrimeSeverity === "severe";
  const inSafeHub = perception.roomIsSafeHub ?? false;

  const shouldWarnForMinorCrime =
    GUARD_WARN_ON_MINOR_CRIME &&
    !severe &&
    (!GUARD_WARN_SAFE_HUB_ONLY || inSafeHub);

  // First-time minor crime in a protected area: issue a warning instead of
  // immediately attacking.
  if (targetId && shouldWarnForMinorCrime && !warned) {
    guardMemory?.markWarned?.(perception.npcId, targetId);

    const guardName = perception.npcName ?? "Guard";

    return {
      kind: "say",
      text:
        `[guard] ${guardName} shouts: ` +
        "Stop attacking citizens or I will cut you down!",
    };
  }

  // Either already warned, or this is a severe crime: escalate.
  if (targetId) {
    guardMemory?.markCalledHelp?.(perception.npcId, targetId);
  }

  // Put the guard on attack cooldown and reuse the aggressive behavior
  // implementation to actually swing at the chosen criminal.
  ctx.setCooldownMs(ctx.attackCooldownMs);

  return decideAggressiveBehavior({
    ...ctx,
    players: [target],
  });
}
