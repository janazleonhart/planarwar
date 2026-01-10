// worldcore/combat/entityCombat.ts

import type { Entity } from "../shared/Entity";
import type { CharacterState } from "../characters/CharacterTypes";
import { computeCombatStatusSnapshot } from "./StatusEffects";
import { computeCowardiceDamageTakenMultiplier } from "./Cowardice";
import { bumpRegionDanger } from "../world/RegionDanger";

const COMBAT_TAG_MS = 15_000; // 15s “in combat” after hit/damage

export function markInCombat(ent: Entity | any): void {
  const e: any = ent;
  const now = Date.now();
  // Original behavior: timestamp for “in combat”
  e.inCombatUntil = now + COMBAT_TAG_MS;
  // v1: also flip a simple flag that higher-level systems can read
  e.inCombat = true;
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
  e.inCombat = false;
}

export interface SimpleDamageResult {
  newHp: number;
  maxHp: number;
  killed: boolean;
}

/**
 * Core “take damage” helper for players.
 *
 * - Still works fine when called with just (target, amount)
 * - If you pass CharacterState, cowardice stacks and status effects
 *   can increase damage taken.
 */
export function applySimpleDamageToPlayer(
  target: Entity,
  amount: number,
  char?: CharacterState,
): SimpleDamageResult {
  const e: any = target;

  const maxHp =
    typeof e.maxHp === "number" && e.maxHp > 0 ? e.maxHp : 100;
  const oldHp =
    typeof e.hp === "number" && e.hp >= 0 ? e.hp : maxHp;

  // Base damage (clamped & floored)
  let dmg = Math.max(0, Math.floor(amount));

  // Risk-mode / cowardice: incoming damage scalar
  if (char) {
    const cowardMult = computeCowardiceDamageTakenMultiplier(char);
    if (cowardMult !== 1) {
      dmg = Math.max(0, Math.floor(dmg * cowardMult));
    }
  }

  // Status-effect driven incoming modifiers (e.g. vulnerability debuffs).
  if (char) {
    try {
      const snapshot = computeCombatStatusSnapshot(char);
      const takenPct = Number(snapshot.damageTakenPct ?? 0);
      if (Number.isFinite(takenPct) && takenPct !== 0) {
        const extraMult = 1 + takenPct;
        if (Number.isFinite(extraMult) && extraMult > 0) {
          dmg = Math.max(0, Math.floor(dmg * extraMult));
        }
      }
    } catch {
      // Best-effort only; status bugs should not break core combat.
    }
  }

  const newHp = Math.max(0, oldHp - dmg);

  e.maxHp = maxHp;
  e.hp = newHp;

  markInCombat(e);

  let killed = false;
  if (newHp <= 0) {
    killEntity(e);
    killed = true;
  }

  if (killed && char) bumpRegionDanger(((char as any).lastRegionId as string) ?? `${char.shardId}:0,0`, 25, `death:${(char as any).name ?? "player"}`, Date.now());

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
