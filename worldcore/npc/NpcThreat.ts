// worldcore/npc/NpcThreat.ts

/**
 * Minimal threat/aggro bookkeeping for NPCs.
 *
 * Tracks the most recent attacker and when that aggro was generated so AI
 * brains have a consistent view of who last harmed or provoked an NPC.
 */
export interface NpcThreatState {
  lastAttackerEntityId?: string;
  lastAggroAt?: number;
}

export function updateThreatFromDamage(
  current: NpcThreatState | undefined,
  attackerEntityId: string,
  now: number = Date.now(),
): NpcThreatState {
  return {
    ...(current ?? {}),
    lastAttackerEntityId: attackerEntityId,
    lastAggroAt: now,
  };
}

export function getLastAttackerFromThreat(
  threat?: NpcThreatState,
): string | undefined {
  return threat?.lastAttackerEntityId;
}
