// worldcore/mud/MudCombatGates.ts
//
// Centralized combat permission / gating for MUD actions.
// This keeps PvP / duel checks consistent across commands (cast, attack, etc.)
// and prevents “rules drift” where each file invents its own logic.

import type { MudContext } from "./MudContext";
import type { CharacterState } from "../characters/CharacterTypes";

import { DUEL_SERVICE } from "../pvp/DuelService";
import { canDamagePlayer } from "../pvp/PvpRules";
import { isPvpEnabledForRegion } from "../world/RegionFlags";

export type PlayerDamageGateResult =
  | {
      allowed: true;
      mode: "duel" | "pvp";
      label: "duel" | "pvp";
      now: number;
      targetChar: CharacterState;
      targetSession: any | null;
    }
  | { allowed: false; reason: string };

/**
 * Gate PvP/duel damage against a player entity (as seen in the world).
 *
 * Expectations:
 * - playerTargetEntity.ownerSessionId must exist to resolve the target session.
 * - duel state is ticked here to keep DUEL_SERVICE time-consistent.
 * - region PvP enablement is checked here (fail-closed).
 * - PvpRules.canDamagePlayer decides final policy (crime flags, duel override, etc).
 */
export async function gatePlayerDamageFromPlayerEntity(
  ctx: MudContext,
  attackerChar: CharacterState,
  roomId: string,
  playerTargetEntity: any,
): Promise<PlayerDamageGateResult> {
  const now = Date.now();
  DUEL_SERVICE.tick(now);

  const ownerSessionId = (playerTargetEntity as any).ownerSessionId as string | undefined;
  const targetSession = ownerSessionId ? (ctx.sessions as any)?.get?.(ownerSessionId) ?? null : null;
  const targetChar =
    (targetSession as any)?.character ?? (targetSession as any)?.char ?? null;

  if (!targetChar?.id) {
    return {
      allowed: false,
      reason: "That player cannot be targeted right now (no character attached).",
    };
  }

  const inDuel = DUEL_SERVICE.isActiveBetween(attackerChar.id, targetChar.id);
  const regionPvpEnabled = await isPvpEnabledForRegion(attackerChar.shardId, roomId);

  const gate = canDamagePlayer(attackerChar, targetChar as any, inDuel, regionPvpEnabled);

  if (!gate.allowed) {
    return { allowed: false, reason: gate.reason };
  }

  return {
    allowed: true,
    mode: gate.mode,
    label: gate.label,
    now,
    targetChar,
    targetSession,
  };
}
