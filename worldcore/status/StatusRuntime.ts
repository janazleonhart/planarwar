// worldcore/status/StatusRuntime.ts
//
// StatusRuntime v1
//
// A small, non-combat-facing wrapper around the StatusEffects spine so we can
// safely use buffs/debuffs outside of combat loops.
//
// The canonical status implementation still lives in:
//   worldcore/combat/StatusEffects.ts
//
// This wrapper is intentionally tiny. It provides:
//  - a canonical "ensure" for character storage shape (progression.statusEffects)
//  - a canonical prune/tick call for player characters
//  - a canonical helper for "is stealthed" checks
//
// Why: as Planar War grows, lots of systems want to *read* statuses without
// importing from /combat directly (or without re-implementing the JSON shape).

import type { CharacterState } from "../characters/CharacterTypes";
import type { EntityManager } from "../core/EntityManager";
import type { SessionManager } from "../core/SessionManager";
import { getActiveStatusEffects, tickStatusEffects } from "../combat/StatusEffects";

type ActiveBucket = any;

export interface CharacterStatusState {
  active: Record<string, ActiveBucket>;
}

/**
 * Ensure the status storage spine exists on the CharacterState.
 *
 * Storage contract:
 *   char.progression.statusEffects.active: Record<string, StatusEffectInstance | StatusEffectInstance[]>
 */
export function ensureCharacterStatusState(char: CharacterState): CharacterStatusState {
  const prog: any = (char as any).progression || {};

  if (!prog.statusEffects || typeof prog.statusEffects !== "object") {
    prog.statusEffects = { active: {} };
  } else if (!prog.statusEffects.active || typeof prog.statusEffects.active !== "object") {
    prog.statusEffects.active = {};
  }

  (char as any).progression = prog;
  return prog.statusEffects as CharacterStatusState;
}

/**
 * Prune expired status effects on a character.
 * This is safe to call out-of-combat.
 */
export function pruneCharacterExpiredStatusEffects(char: CharacterState, now: number): void {
  tickStatusEffects(char, now);
}

/**
 * Returns true if the character currently has any active status effect tagged "stealth".
 */
export function isCharacterStealthed(char: CharacterState, now: number): boolean {
  try {
    const active = getActiveStatusEffects(char, now) as any[];
    for (const inst of active) {
      const tags = Array.isArray(inst?.tags) ? inst.tags : [];
      if (tags.some((t: any) => String(t).toLowerCase() === "stealth")) return true;
    }
  } catch {
    // best-effort only
  }
  return false;
}

/**
 * Prune status expirations for all connected player characters.
 *
 * NOTE: This does not tick HOTs/DOTs; it only prunes and clamps the spine.
 * Periodics are handled by the dedicated tickers.
 */
export function pruneAllConnectedPlayerStatuses(
  _entities: EntityManager,
  sessions: SessionManager,
  now: number,
): void {
  const sessIter: any[] = (() => {
    const s: any = sessions as any;
    if (typeof s.getAllSessions === "function") return s.getAllSessions();
    if (typeof s.values === "function") return Array.from(s.values());
    return [];
  })();

  for (const sess of sessIter) {
    const char = (sess as any)?.character as CharacterState | undefined;
    if (!char) continue;
    ensureCharacterStatusState(char);
    pruneCharacterExpiredStatusEffects(char, now);
  }
}
