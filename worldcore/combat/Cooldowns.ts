// worldcore/combat/Cooldowns.ts

import type { CharacterState } from "../characters/CharacterTypes";

export interface CooldownEntry {
  readyAt: number; // epoch ms
}

export interface CooldownMap {
  [key: string]: CooldownEntry;
}

function ensureCooldownRoot(char: CharacterState): any {
  const prog: any = char.progression || {};
  if (!prog.cooldowns) {
    prog.cooldowns = {};
    char.progression = prog;
  }
  return prog.cooldowns as { [category: string]: CooldownMap };
}

/** Get or create a named cooldown bucket, e.g. "spells", "abilities". */
export function ensureCooldownBucket(
  char: CharacterState,
  bucket: string
): CooldownMap {
  const root = ensureCooldownRoot(char);
  if (!root[bucket]) {
    root[bucket] = {};
  }
  return root[bucket] as CooldownMap;
}

/**
 * Returns remaining ms if still on cooldown, or 0 if ready.
 */
export function getCooldownRemaining(
  char: CharacterState,
  bucket: string,
  key: string,
  now: number = Date.now()
): number {
  const map = ensureCooldownBucket(char, bucket);
  const entry = map[key];
  if (!entry) return 0;
  const remaining = entry.readyAt - now;
  return remaining > 0 ? remaining : 0;
}

/**
 * Start / reset a cooldown.
 */
export function startCooldown(
  char: CharacterState,
  bucket: string,
  key: string,
  durationMs: number,
  now: number = Date.now()
): void {
  if (durationMs <= 0) return;
  const map = ensureCooldownBucket(char, bucket);
  map[key] = { readyAt: now + durationMs };
}

/**
 * Helper: check and, if ready, start cooldown in one go.
 * Returns error string if still cooling, or null if started successfully.
 */
export function checkAndStartCooldown(
  char: CharacterState,
  bucket: string,
  key: string,
  durationMs: number,
  displayName: string,
  now: number = Date.now()
): string | null {
  const remaining = getCooldownRemaining(char, bucket, key, now);
  if (remaining > 0) {
    const secs = Math.ceil(remaining / 1000);
    return `${displayName} is on cooldown for another ${secs}s.`;
  }

  startCooldown(char, bucket, key, durationMs, now);
  return null;
}
