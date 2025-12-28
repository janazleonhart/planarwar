import { type NpcDecision, type PerceivedPlayer } from "../NpcBrainTypes";
import { decideAggressiveBehavior } from "./AggressiveBrain";
import { type BehaviorContext } from "./BehaviorContext";

const ROLE_PRIORITY: Record<string, number> = {
  healer: 0,
  dps: 1,
  tank: 2,
};

export function pickGuardTarget(
  players: PerceivedPlayer[],
  now: number = Date.now(),
): PerceivedPlayer | undefined {
  const criminals = players.filter((p) => (p.recentCrimeUntil ?? 0) > now);
  if (criminals.length === 0) return undefined;

  return criminals.sort((a, b) => {
    const roleA = ROLE_PRIORITY[a.combatRole ?? "dps"] ?? 3;
    const roleB = ROLE_PRIORITY[b.combatRole ?? "dps"] ?? 3;
    if (roleA !== roleB) return roleA - roleB;

    const hpPctA = a.maxHp > 0 ? a.hp / a.maxHp : 0;
    const hpPctB = b.maxHp > 0 ? b.hp / b.maxHp : 0;
    return hpPctA - hpPctB;
  })[0];
}

export function decideGuardBehavior(ctx: BehaviorContext): NpcDecision | null {
  const { perception, players, guardMemory } = ctx;
  const now = Date.now();
  const target = pickGuardTarget(players, now);
  if (!target) {
    return null;
  }

  const targetId = target.characterId ?? target.entityId;
  const warned =
    targetId && guardMemory?.hasWarned
      ? guardMemory.hasWarned(perception.npcId, targetId)
      : false;
  const severe = target.recentCrimeSeverity === "severe";
  const inSafeHub = perception.roomIsSafeHub ?? false;

  if (inSafeHub && !warned && !severe && targetId) {
    guardMemory?.markWarned?.(perception.npcId, targetId);
    return {
      kind: "say",
      text:
        `[guard] ${perception.npcName ?? "Guard"} shouts: ` +
        "Stop attacking citizens or I will cut you down!",
    };
  }

  guardMemory?.markCalledHelp?.(perception.npcId, targetId);
  ctx.setCooldownMs(ctx.attackCooldownMs);

  return decideAggressiveBehavior({
    ...ctx,
    players: [target],
  });
}
