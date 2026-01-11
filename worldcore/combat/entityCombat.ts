// worldcore/combat/entityCombat.ts

import type { Entity } from "../shared/Entity";
import type { CharacterState } from "../characters/CharacterTypes";
import type { CombatResult, DamageSchool } from "./CombatEngine";
import { computeCombatStatusSnapshot } from "./StatusEffects";
import { computeCowardiceDamageTakenMultiplier } from "./Cowardice";
import { bumpRegionDanger } from "../world/RegionDanger";

const COMBAT_TAG_MS = 15_000; // 15s “in combat” after hit/damage

export type SimpleDamageResult = {
  newHp: number;
  maxHp: number;
  killed: boolean;
};

export type DamageMode = "pve" | "pvp" | "duel";

export type DamageContext = {
  /**
   * Reserved hook for future dueling/PvP scaling and rules.
   */
  mode?: DamageMode;

  /**
   * SAFETY RAIL:
   * When true, we will NOT apply StatusEffects-based incoming modifiers here:
   * - damageTakenPct
   * - damageTakenPctBySchool[school]
   *
   * Use this when the damage number already includes incoming taken modifiers
   * (e.g., computeDamage(... applyDefenderDamageTakenMods: true)).
   *
   * NOTE: Cowardice scalar (computeCowardiceDamageTakenMultiplier) still applies
   * because CombatEngine does not currently include it.
   */
  incomingModsAlreadyApplied?: boolean;
};

export function markInCombat(ent: Entity | any): void {
  const e: any = ent;
  const now = Date.now();
  e.inCombatUntil = now + COMBAT_TAG_MS;
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
}

/**
 * Internal shared implementation so we can safely support:
 * - normal “incoming mods happen here” pipeline
 * - “incoming mods already applied” pipeline (no double-dip)
 */
function applyDamageToPlayerInternal(
  target: Entity,
  amount: number,
  char?: CharacterState,
  school?: DamageSchool,
  ctx?: DamageContext,
): SimpleDamageResult {
  const e: any = target;

  const maxHp = typeof e.maxHp === "number" && e.maxHp > 0 ? e.maxHp : 100;
  const oldHp = typeof e.hp === "number" && e.hp >= 0 ? e.hp : maxHp;

  const amt = Number.isFinite(amount) ? amount : 0;

  // Base damage rounding:
  let dmg = Math.max(0, Math.floor(amt));
  if (amt > 0 && dmg < 1) dmg = 1;

  // PvP/Duel hook (reserved): no scaling in v1.
  const mode = ctx?.mode ?? "pve";
  if (mode === "pvp" || mode === "duel") {
    const pvpMult = 1;
    if (pvpMult !== 1) {
      dmg = Math.max(0, Math.floor(dmg * pvpMult));
    }
  }

  if (char) {
    // Cowardice: incoming damage scalar (>= 1 in current design).
    // CombatEngine does NOT apply this, so it should always be applied here.
    const cowardMult = computeCowardiceDamageTakenMultiplier(char);
    if (cowardMult !== 1) {
      dmg = Math.max(0, Math.floor(dmg * cowardMult));
    }

    // Status modifiers (global + per-school), additive.
    // These may already be applied in CombatEngine when:
    //   computeDamage(... applyDefenderDamageTakenMods: true)
    // In that case, skip to prevent double-dipping.
    const skipStatus = ctx?.incomingModsAlreadyApplied === true;

    if (!skipStatus) {
      try {
        const snapshot = computeCombatStatusSnapshot(char);

        const globalTaken = Number(snapshot.damageTakenPct ?? 0);
        const perSchoolTaken =
          school && snapshot.damageTakenPctBySchool
            ? Number((snapshot.damageTakenPctBySchool as any)[school] ?? 0)
            : 0;

        const totalTaken =
          (Number.isFinite(globalTaken) ? globalTaken : 0) +
          (Number.isFinite(perSchoolTaken) ? perSchoolTaken : 0);

        if (totalTaken) {
          const mult = 1 + totalTaken;
          if (Number.isFinite(mult) && mult > 0) {
            dmg = Math.max(0, Math.floor(dmg * mult));
          }
        }
      } catch {
        // Best-effort only; status bugs should not break core combat.
      }
    }
  }

  // Min-damage rule final guard
  if (amt > 0 && dmg < 1) dmg = 1;

  const newHp = Math.max(0, oldHp - dmg);
  e.maxHp = maxHp;
  e.hp = newHp;

  markInCombat(e);

  let killed = false;
  if (newHp <= 0) {
    killEntity(e);
    killed = true;
  }

  if (killed && char) {
    bumpRegionDanger(
      (char as any).lastRegionId ?? `${(char as any).shardId ?? "prime_shard"}:0,0`,
      25,
      `death:${(char as any).name ?? "player"}`,
      Date.now(),
    );
  }

  return { newHp, maxHp, killed };
}

/**
 * Apply a simple, unconditional chunk of damage to a player entity.
 *
 * Incoming modifiers (additive):
 * - cowardice damage taken multiplier (scalar)
 * - StatusEffects snapshot:
 *   - damageTakenPct (global)
 *   - damageTakenPctBySchool[school] (per-school; only if school is provided)
 *
 * IMPORTANT ORDERING:
 * - Mitigation occurs earlier inside computeDamage() and is already floored.
 * - Incoming multipliers happen HERE (and are floored), unless ctx.incomingModsAlreadyApplied is true.
 *
 * Min-damage rule v1:
 * - If amount > 0 (even fractional), it becomes at least 1 after rounding/modifiers.
 * - amount <= 0 stays 0.
 */
export function applySimpleDamageToPlayer(
  target: Entity,
  amount: number,
  char?: CharacterState,
  school?: DamageSchool,
  ctx?: DamageContext,
): SimpleDamageResult {
  return applyDamageToPlayerInternal(target, amount, char, school, ctx);
}

/**
 * SAFER PIPELINE:
 * Apply a CombatEngine CombatResult to a player entity without risking double-dipping.
 *
 * If result.includesDefenderTakenMods is true, we assume StatusEffects taken-mods
 * already happened in CombatEngine and we skip them here via ctx.incomingModsAlreadyApplied.
 *
 * Cowardice scalar still applies (CombatEngine does not include it).
 */
export function applyCombatResultToPlayer(
  target: Entity,
  result: CombatResult,
  char?: CharacterState,
  ctx?: DamageContext,
): SimpleDamageResult {
  const mergedCtx: DamageContext = {
    ...(ctx ?? {}),
    incomingModsAlreadyApplied: (ctx?.incomingModsAlreadyApplied ?? false) || !!result.includesDefenderTakenMods,
  };

  return applyDamageToPlayerInternal(target, result.damage, char, result.school, mergedCtx);
}

/**
 * Shared v1 NPC melee damage formula.
 */
export function computeNpcMeleeDamage(npc: Entity): number {
  const n: any = npc;
  const npcMaxHp = typeof n.maxHp === "number" && n.maxHp > 0 ? n.maxHp : 100;
  const base =
    typeof n.attackPower === "number"
      ? n.attackPower
      : Math.max(1, Math.round(npcMaxHp * 0.03)); // ~3% of its own HP

  const roll = 0.8 + Math.random() * 0.4; // ±20%
  const dmg = Math.max(1, Math.floor(base * roll));
  return dmg;
}
