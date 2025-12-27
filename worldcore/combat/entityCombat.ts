// worldcore/combat/entityCombat.ts

import type { Entity } from "../shared/Entity";

const COMBAT_TAG_MS = 10_000; // 10s “in combat” after hit/damage

export function markInCombat(ent: Entity | any): void {
  (ent as any).inCombatUntil = Date.now() + COMBAT_TAG_MS;
}

export function killEntity(ent: Entity | any): void {
  const e: any = ent;
  if (typeof e.hp === "number") e.hp = 0;
  e.alive = false;
}

export function isDeadEntity(ent: Entity | any): boolean {
  const e: any = ent;
  if (e.alive === false) return true;
  return typeof e.hp === "number" && e.hp <= 0;
}

export function resurrectEntity(ent: Entity | any): void {
  const e: any = ent;
  if (typeof e.maxHp === "number" && e.maxHp > 0) {
    e.hp = e.maxHp;
  } else {
    e.maxHp = 100;
    e.hp = 100;
  }
  e.alive = true;
  e.inCombatUntil = 0;
}

export interface SimpleDamageResult {
  newHp: number;
  maxHp: number;
  killed: boolean;
}

export function applySimpleDamageToPlayer(
  target: Entity,
  amount: number
): SimpleDamageResult {
  const e: any = target;
  const maxHp =
    typeof e.maxHp === "number" && e.maxHp > 0 ? e.maxHp : 100;
  const oldHp = typeof e.hp === "number" ? e.hp : maxHp;
  const dmg = Math.max(0, Math.floor(amount));
  const newHp = Math.max(0, oldHp - dmg);

  e.maxHp = maxHp;
  e.hp = newHp;

  markInCombat(e);

  let killed = false;
  if (newHp <= 0) {
    killEntity(e);
    killed = true;
  }

  return { newHp, maxHp, killed };
}

/**
 * Shared v1 NPC melee damage formula.
 *
 * - Uses NPC's own power:
 *   - explicit `attackPower` if present
 *   - otherwise ~3% of its own max HP as baseline
 * - Adds ±20% randomness.
 */
export function computeNpcMeleeDamage(npc: Entity): number {
  const n: any = npc;
  const npcMaxHp =
    typeof n.maxHp === "number" && n.maxHp > 0 ? n.maxHp : 100;

  const base =
    typeof n.attackPower === "number"
      ? n.attackPower
      : Math.max(1, Math.round(npcMaxHp * 0.03)); // ~3% of its own HP

  const roll = 0.8 + Math.random() * 0.4; // ±20%
  const dmg = Math.max(1, Math.floor(base * roll));
  return dmg;
}
