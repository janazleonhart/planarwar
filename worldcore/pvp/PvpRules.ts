// worldcore/pvp/PvpRules.ts
//
// Centralized PvP gating rules (v1).
//
// Philosophy:
// - Default = fail-closed (no player-vs-player damage).
// - Allowed when:
//    * players are in an active Duel (consent-based), OR
//    * the current region/plane is flagged as open PvP.
// - In open-PvP regions, we still want a notion of "allies" so people can cooperate
//   during invasions/warfronts without constantly friendly-firing each other.
//
// Current ally rule (minimal, safe):
// - Characters in the same guild are treated as allies (friendly fire blocked in open PvP).
//
// Later expansions (planned):
// - Declared factions / warfront sides / parties/raids
// - Optional per-region friendly-fire rules

import type { CharacterState } from "../characters/CharacterTypes";

export type PlayerDamageMode = "duel" | "pvp";

export type PvpGateResult =
  | { allowed: true; mode: PlayerDamageMode; label: "duel" | "pvp" }
  | { allowed: false; mode: null; label: null; reason: string };

export function areAllies(attacker: CharacterState, defender: CharacterState): boolean {
  const ga = attacker.guildId ?? null;
  const gb = defender.guildId ?? null;
  return !!ga && !!gb && ga === gb;
}

/**
 * Shared PvP gate used by BOTH melee and spells.
 *
 * - Duel: always allows damage between participants (even if allies).
 * - Open PvP region: allows damage unless the two players are allies.
 * - Otherwise: blocked.
 */
export function canDamagePlayer(
  attacker: CharacterState,
  defender: CharacterState,
  inDuel: boolean,
  regionPvpEnabled: boolean,
): PvpGateResult {
  if (inDuel) return { allowed: true, mode: "duel", label: "duel" };

  if (regionPvpEnabled) {
    if (areAllies(attacker, defender)) {
      return {
        allowed: false,
        mode: null,
        label: null,
        reason:
          "Friendly fire is blocked for allies here (same guild). Duel to spar, or fight an enemy.",
      };
    }
    return { allowed: true, mode: "pvp", label: "pvp" };
  }

  return {
    allowed: false,
    mode: null,
    label: null,
    reason: "You can't harm other players here. Try: duel <name> (or go to a PvP region).",
  };
}

/**
 * Back-compat wrapper used by older call sites.
 * Prefer canDamagePlayer() for new code.
 */
export function resolvePlayerDamageMode(
  inDuel: boolean,
  regionPvpEnabled: boolean,
): { allowed: boolean; mode: PlayerDamageMode | null } {
  if (inDuel) return { allowed: true, mode: "duel" };
  if (regionPvpEnabled) return { allowed: true, mode: "pvp" };
  return { allowed: false, mode: null };
}
