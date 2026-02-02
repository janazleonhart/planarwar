// worldcore/combat/CastingGates.ts
//
// Centralized cost + cooldown gates for player actions (spells, songs, abilities).
//
// Rule: if an action fails, it must NOT accidentally start cooldowns or consume resources.
// - Cooldown is checked first (no mutation).
// - Resource is spent second (mutation).
// - Cooldown is started last (mutation).
// - On success, optional post-success resource gains may apply (builders).
//
// This module is intentionally small + deterministic to make contract tests easy.

import type { CharacterState } from "../characters/CharacterTypes";
import type { PowerResourceKind } from "../resources/PowerResources";

import { getCooldownRemaining, checkAndStartCooldown } from "./Cooldowns";
import { gainPowerResource, trySpendPowerResource } from "../resources/PowerResources";

const RUNIC_POWER_BUILDERS: Record<string, number> = {
  // v1: Rune Strike is the primary early builder.
  // It should always be usable at 0 RP (cost=0) and grant RP on use.
  "runic_knight_rune_strike": 12,
};

export type ActionCostCooldownGateArgs = {
  char: CharacterState;

  bucket: "spells" | "abilities" | string;
  key: string;
  displayName: string;

  cooldownMs?: number;

  resourceType?: PowerResourceKind | null;
  resourceCost?: number;

  now?: number;
};

/**
 * Applies cooldown + resource gates for an action, mutating `char` on success.
 *
 * Returns a user-facing error string on failure, or null on success.
 */
export function applyActionCostAndCooldownGates(args: ActionCostCooldownGateArgs): string | null {
  const now = Number.isFinite(Number(args.now)) ? Number(args.now) : Date.now();

  const bucket = String(args.bucket ?? "spells");
  const key = String(args.key ?? "").trim();
  const name = String(args.displayName ?? "That").trim() || "That";

  const cooldownMs = Math.max(0, Number(args.cooldownMs ?? 0));
  const resourceCost = Math.max(0, Number(args.resourceCost ?? 0));
  const resourceType = (args.resourceType ?? null) as PowerResourceKind | null;

  if (!key) return "That action is missing an id; it cannot be used right now.";

  // 1) Cooldown check (no mutation)
  if (cooldownMs > 0) {
    const remaining = getCooldownRemaining(args.char, bucket, key, now);
    if (remaining > 0) {
      const secs = Math.ceil(remaining / 1000);
      return `${name} is on cooldown for another ${secs}s.`;
    }
  }

  // 2) Resource spend (mutation)
  if (resourceType && resourceCost > 0) {
    const resErr = trySpendPowerResource(args.char, resourceType, resourceCost);
    if (resErr) return resErr;
  }

  // 3) Start cooldown (mutation)
  if (cooldownMs > 0) {
    const cdErr = checkAndStartCooldown(args.char, bucket, key, cooldownMs, name, now);
    if (cdErr) return cdErr;
  }

  // 4) Post-success builders (mutation)
  const rpGain = RUNIC_POWER_BUILDERS[key];
  if (Number.isFinite(rpGain) && rpGain > 0) {
    gainPowerResource(args.char, "runic_power", rpGain);
  }

  return null;
}
