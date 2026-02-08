// worldcore/combat/CombatTargeting.ts
//
// Engage State Law v1: shared combat target validity rules.
//
// Goal: centralize "can this entity currently be engaged/attacked?" checks so
// NPC brains, NPC manager, and command paths don't drift.
//
// This is intentionally conservative and dependency-light.

import type { Entity } from "../shared/Entity";
import { getActiveStatusEffectsForEntity } from "./StatusEffects";
import { isServiceProtectedEntity } from "./ServiceProtection";

export type CombatTargetValidity =
  | { ok: true }
  | { ok: false; reason: string };

export type CombatTargetingOpts = {
  now: number;
  attacker: Entity | null | undefined;
  target: Entity | null | undefined;

  /**
   * Room id of the attacker at the moment of evaluation.
   * If provided and allowCrossRoom is false, targets in other rooms are invalid.
   */
  attackerRoomId?: string;

  /**
   * When true, allows targets in other rooms (e.g. Train System room pursuit).
   * Note: this does NOT mean you can HIT across rooms; it only affects validity.
   */
  allowCrossRoom?: boolean;
};

function hasTag(inst: any, tag: string): boolean {
  const tags = inst?.tags;
  return Array.isArray(tags) && tags.includes(tag);
}

export function isValidCombatTarget(opts: CombatTargetingOpts): CombatTargetValidity {
  const { now, target, attackerRoomId, allowCrossRoom } = opts;

  if (!target) return { ok: false, reason: "missing" };

  // Dead targets are never valid.
  if ((target as any).alive === false) return { ok: false, reason: "dead" };
  const hp = (target as any).hp;
  if (typeof hp === "number" && hp <= 0) return { ok: false, reason: "dead" };

  // Protected/service providers should not be attackable (town services etc.).
  if (isServiceProtectedEntity(target) || (target as any).invulnerable === true) {
    return { ok: false, reason: "protected" };
  }

  // Room gating (unless explicitly allowed).
  if (attackerRoomId && !allowCrossRoom) {
    const tr = String((target as any).roomId ?? "");
    if (tr && tr !== attackerRoomId) return { ok: false, reason: "out_of_room" };
  }

  // Visibility gating: stealth makes players invalid targets for NPC engage.
  const type = String((target as any).type ?? "");
  if (type === "player" || type === "character") {
    const active = getActiveStatusEffectsForEntity(target, now);
    if (active.some((se) => hasTag(se, "stealth"))) {
      return { ok: false, reason: "stealth" };
    }
  }

  return { ok: true };
}
