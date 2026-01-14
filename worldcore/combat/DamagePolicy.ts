// worldcore/combat/DamagePolicy.ts
//
// Centralized “can I damage this target?” policy layer.
// v1 goals:
// - Block damage to protected service entities (bankers/mailboxes/etc).
// - Fail-closed PvP: player-vs-player damage is blocked unless explicitly allowed.
// - Support region-level combat disable (combatEnabled=false) when region context provided.
// - Be test-safe: do not touch Postgres under node --test.

import type { CharacterState } from "../characters/CharacterTypes";
import { canDamagePlayer, type PvpGateResult } from "../pvp/PvpRules";
import { isServiceProtectedEntity, serviceProtectedCombatLine } from "./ServiceProtection";

export type DamagePolicyDecision =
  | { allowed: true; mode: "pve" | "pvp" | "duel"; label: "pve" | "pvp" | "duel" }
  | { allowed: false; reason: string };

export type PlayerVsPlayerPolicyContext = {
  shardId: string;
  regionId: string;
  inDuel: boolean;

  // Optional overrides (important for unit tests)
  regionCombatEnabled?: boolean;
  regionPvpEnabled?: boolean;
};

export type CanDamageContext = {
  shardId?: string;
  regionId?: string;

  // Optional overrides (important for unit tests)
  regionCombatEnabled?: boolean;
  regionPvpEnabled?: boolean;

  inDuel?: boolean;
  ignoreServiceProtection?: boolean;
};

function isNodeTestRuntime(): boolean {
  return (
    process.execArgv.includes("--test") ||
    process.argv.includes("--test") ||
    process.env.NODE_ENV === "test" ||
    process.env.WORLDCORE_TEST === "1"
  );
}

function deny(reason: string): DamagePolicyDecision {
  return { allowed: false, reason };
}

function svcLine(target: any): string {
  const name =
    typeof target?.name === "string" && target.name.trim()
      ? target.name.trim()
      : "That target";
  return serviceProtectedCombatLine(name);
}

export function serviceProtectionGate(
  defenderEntity: any,
  opts?: { ignore?: boolean },
): DamagePolicyDecision | null {
  if (opts?.ignore) return null;
  if (isServiceProtectedEntity(defenderEntity)) return deny(svcLine(defenderEntity));
  return null;
}

async function resolveRegionCombatEnabled(
  shardId: string,
  regionId: string,
  override?: boolean,
): Promise<boolean> {
  if (typeof override === "boolean") return override;

  // In tests we still consult RegionFlags, which is itself test-safe (no DB) and can be overridden.

  const mod = await import("../world/RegionFlags");
  if (typeof mod.isCombatEnabledForRegion === "function") {
    return await mod.isCombatEnabledForRegion(shardId, regionId);
  }

  // Back-compat: if the helper doesn't exist yet, fall back to default allow.
  return true;
}

async function resolveRegionPvpEnabled(
  shardId: string,
  regionId: string,
  override?: boolean,
): Promise<boolean> {
  if (typeof override === "boolean") return override;

  // Unit tests: fail-closed for PvP unless explicitly overridden.
  if (isNodeTestRuntime()) return false;

  const mod = await import("../world/RegionFlags");
  return await mod.isPvpEnabledForRegion(shardId, regionId);
}

/**
 * PvP/duel policy gate (player vs player).
 *
 * Returns PvpGateResult for compatibility with existing PvP tests.
 */
export async function resolvePlayerVsPlayerPolicy(
  attacker: CharacterState,
  defender: CharacterState,
  ctx: PlayerVsPlayerPolicyContext,
): Promise<PvpGateResult> {
  const regionCombatEnabled = await resolveRegionCombatEnabled(
    ctx.shardId,
    ctx.regionId,
    ctx.regionCombatEnabled,
  );

  if (regionCombatEnabled === false) {
    return { allowed: false, mode: null, label: null, reason: "Combat is disabled in this region." };
  }

  const regionPvpEnabled = await resolveRegionPvpEnabled(
    ctx.shardId,
    ctx.regionId,
    ctx.regionPvpEnabled,
  );

  return canDamagePlayer(attacker, defender as any, !!ctx.inDuel, !!regionPvpEnabled);
}

/**
 * Generic combat permission check (async; can consult RegionFlags).
 */
export async function canDamage(
  attacker: { entity?: any; char?: CharacterState },
  defender: { entity?: any; char?: CharacterState },
  ctx: CanDamageContext = {},
): Promise<DamagePolicyDecision> {
  // 1) Service protection (defender is immune)
  const svc = serviceProtectionGate(defender.entity, { ignore: ctx.ignoreServiceProtection });
  if (svc) return svc;

  // 2) Region combatEnabled gate (only when region context provided)
  if (ctx.shardId && ctx.regionId) {
    const enabled = await resolveRegionCombatEnabled(ctx.shardId, ctx.regionId, ctx.regionCombatEnabled);
    if (enabled === false) return deny("Combat is disabled in this region.");
  }

  // 3) PvP gate when both characters exist and are distinct
  const a = attacker.char;
  const d = defender.char;
  if (a?.id && d?.id && a.id !== d.id) {
    const shardId = ctx.shardId ?? a.shardId;
    const regionId = ctx.regionId;

    // Fail-closed without region context.
    const regionPvpEnabled =
      shardId && regionId
        ? await resolveRegionPvpEnabled(shardId, regionId, ctx.regionPvpEnabled)
        : false;

    const gate = canDamagePlayer(a, d as any, !!ctx.inDuel, !!regionPvpEnabled);
    if (!gate.allowed) return deny(gate.reason);

    return { allowed: true, mode: gate.mode, label: gate.label };
  }

  // Default: PvE allowed
  return { allowed: true, mode: "pve", label: "pve" };
}

/**
 * Synchronous “best-effort” policy check.
 *
 * - Enforces service protection immediately.
 * - Enforces PvP rules (fail-closed unless ctx.regionPvpEnabled is true or ctx.inDuel is true).
 * - Enforces region combat enable ONLY when ctx.regionCombatEnabled is explicitly provided.
 *
 * This function never touches Postgres or other I/O. If you need DB-backed
 * region flags, use the async canDamage(...).
 */
export function canDamageFast(
  attacker: { entity?: any; char?: CharacterState },
  defender: { entity?: any; char?: CharacterState },
  ctx: CanDamageContext = {},
): DamagePolicyDecision {
  // 1) Service protection (defender is immune)
  const svc = serviceProtectionGate(defender.entity, { ignore: ctx.ignoreServiceProtection });
  if (svc) return svc;

  // 2) Region combatEnabled gate (only when explicit override provided)
  if (ctx.shardId && ctx.regionId && typeof ctx.regionCombatEnabled === "boolean") {
    if (ctx.regionCombatEnabled === false) return deny("Combat is disabled in this region.");
  }

  // 3) PvP gate when both characters exist and are distinct
  const a = attacker.char;
  const d = defender.char;
  if (a?.id && d?.id && a.id !== d.id) {
    const regionPvpEnabled = typeof ctx.regionPvpEnabled === "boolean" ? ctx.regionPvpEnabled : false;
    const gate = canDamagePlayer(a, d as any, !!ctx.inDuel, !!regionPvpEnabled);
    if (!gate.allowed) return deny(gate.reason);

    return { allowed: true, mode: gate.mode, label: gate.label };
  }

  // Default: PvE allowed
  return { allowed: true, mode: "pve", label: "pve" };
}
