// worldcore/mud/MudTrainingDummy.ts
//
// Training Dummy service v0.2
//
// Provides per-room training dummy state for DPS testing.
//
// Behaviour:
//  - Training dummy has its own HP pool (separate from the NPC entity).
//  - Player damage against the dummy is computed via computeTrainingDummyDamage
//    and shown as a combat line (used by MudCombatActions).
//  - v0.2: The dummy NO LONGER attacks the player. The old AI loop that
//    periodically hit the player has been disabled; startTrainingDummyAi is
//    now a no-op, kept only for API compatibility.

import { MudContext } from "./MudContext";
import type { Attributes } from "../characters/CharacterTypes";
import {
  markInCombat,
  isDeadEntity,
  applySimpleDamageToPlayer,
} from "../combat/entityCombat";
import { Logger } from "../utils/logger";

const log = Logger.scope("MUD");

const TRAINING_DUMMIES = new Map<string, TrainingDummyState>();

// We keep this map + type for compatibility with the original design,
// but v0.2 does not actually schedule any timers.
const DUMMY_AI = new Map<string, DummyAiEntry>();

// In v0.1 this controlled how often the dummy would swing back.
// v0.2 disables outgoing dummy attacks, but we keep the constant for clarity.
const DUMMY_ATTACK_INTERVAL_MS = 3000; // 3s between dummy swings

export interface TrainingDummyState {
  roomId: string;
  hp: number;
  maxHp: number;
}

export interface DummyAiEntry {
  timer: any; // NodeJS.Timeout, kept as any to avoid import noise
  roomId: string;
  intervalMs: number;
}

/**
 * Get (or lazily create) the TrainingDummyState for a given room.
 *
 * Note: this HP is *not* the actual NPC entity's HP; it's a separate pool used
 * solely for DPS testing and cosmetic combat messages.
 */
export function getTrainingDummyForRoom(roomId: string): TrainingDummyState {
  let dummy = TRAINING_DUMMIES.get(roomId);
  if (!dummy) {
    dummy = {
      roomId,
      hp: 200, // simple baseline; tweak later if needed
      maxHp: 200,
    };
    TRAINING_DUMMIES.set(roomId, dummy);
  }
  return dummy;
}

/**
 * Compute how hard the *player* should hit the Training Dummy.
 *
 * Used by MudCombatActions to generate the "You hit the Training Dummy for X"
 * messages and adjust the dummy's hp/maxHp values for display.
 */
export function computeTrainingDummyDamage(attrs: Attributes): number {
  // Very rough: base 5 + STR + half AGI bonus.
  const strBonus = Math.max(0, attrs.str - 10);
  const agiBonus = Math.max(0, Math.floor((attrs.agi - 10) / 2));
  const base = 5;
  return Math.max(1, base + strBonus + agiBonus);
}

/**
 * Stop any per-session dummy AI.
 *
 * v0.2: no timers are started anymore, but we keep this for compatibility.
 */
export function stopTrainingDummyAi(sessionId: string): void {
  const entry = DUMMY_AI.get(sessionId);
  if (!entry) return;

  clearInterval(entry.timer);
  DUMMY_AI.delete(sessionId);
}

/**
 * v0.2: Training Dummy AI is disabled.
 *
 * In v0.1 this function would:
 *  - start a repeating timer,
 *  - look up the player each tick,
 *  - and apply damage to the player via applySimpleDamageToPlayer,
 *    sending combat lines like "The Training Dummy hits you for X".
 *
 * That behaviour made the dummy effectively lethal. For now we explicitly
 * *do not* allow the dummy to damage players. This function is kept as a
 * no-op so callers (MudCombatActions, autoattack toggles, etc.) can still
 * call it without breaking.
 */
export function startTrainingDummyAi(
  _ctx: MudContext,
  _sessionId: string,
  roomId: string,
): void {
  // Ensure the room has a dummy state registered so MudCombatActions
  // can still show HP lines, but do not schedule any outgoing attacks.
  const dummy = getTrainingDummyForRoom(roomId);
  markInCombat(dummy);
  log.debug("Training dummy AI disabled; no outgoing attacks will be made.", {
    roomId: dummy.roomId,
  });
}

/*
 * NOTE: The old v0.1 implementation for startTrainingDummyAi looked roughly
 * like this (simplified):
 *
 *   if (DUMMY_AI.has(sessionId)) return;
 *   const timer = setInterval(() => {
 *     ... look up player entity ...
 *     ... compute dmg based on % of max HP ...
 *     const { newHp, killed } = applySimpleDamageToPlayer(ent, dmg);
 *     markInCombat(dummy);
 *     ... send combat lines, stop on death ...
 *   }, DUMMY_ATTACK_INTERVAL_MS);
 *
 * We intentionally removed that loop here to keep training spaces safe.
 */
