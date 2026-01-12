// worldcore/mud/MudCombatGates.ts
//
// Centralized combat permission / gating for MUD actions.
//
// This file is the ONLY place in worldcore/mud that should decide PvP/duel permissions.
// (A contract test enforces this.)

import type { MudContext } from "./MudContext";
import type { CharacterState } from "../characters/CharacterTypes";

import { DUEL_SERVICE } from "../pvp/DuelService";
import { resolvePlayerVsPlayerPolicy } from "../combat/DamagePolicy";

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
 * - PvP rules are resolved via combat/DamagePolicy (which consults RegionFlags + PvpRules).
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
  const targetSession = ownerSessionId
    ? (ctx.sessions as any)?.get?.(ownerSessionId) ?? null
    : null;

  const targetChar = (targetSession as any)?.character ?? (targetSession as any)?.char ?? null;

  if (!targetChar?.id) {
    return {
      allowed: false,
      reason: "That player cannot be targeted right now (no character attached).",
    };
  }

  const inDuel = DUEL_SERVICE.isActiveBetween(attackerChar.id, targetChar.id);

  const gate = await resolvePlayerVsPlayerPolicy(attackerChar, targetChar as any, {
    shardId: attackerChar.shardId,
    regionId: roomId,
    inDuel,
  });

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
