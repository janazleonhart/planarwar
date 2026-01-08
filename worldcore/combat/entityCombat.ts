// worldcore/combat/entityCombat.ts

import type { Entity } from "../shared/Entity";
import type { CharacterState } from "../characters/CharacterTypes";

const COMBAT_TAG_MS = 15_000; // 15s “in combat” after hit/damage

export function markInCombat(ent: Entity | any): void {
  const e: any = ent;
  const now = Date.now();

  // Original behavior: timestamp for “in combat”
  e.inCombatUntil = now + COMBAT_TAG_MS;

  // v1: also flip a simple flag that higher-level systems can read
  // (walkto's isInCombat() already checks ent.inCombat)
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
  e.inCombatUntil = 0;
  e.inCombat = false;
}

export interface SimpleDamageResult {
  newHp: number;
  maxHp: number;
  killed: boolean;
}

/**
 * Read cowardice state off the character and turn it into a damage multiplier.
 *
 * - Stacks + duration are owned by walktoCommand.ts
 * - We only *read* them here and apply a mild scalar.
 */
function computeCowardiceDamageTakenMultiplier(char?: CharacterState): number {
  if (!char) return 1;

  const anyChar: any = char as any;
  const flags = anyChar.progression?.flags;
  if (!flags) return 1;

  const stacksRaw = flags.walktoCowardiceStacks ?? 0;
  const until = flags.walktoCowardiceUntilMs ?? 0;

  if (!stacksRaw || stacksRaw <= 0) return 1;
  if (until && until <= Date.now()) {
    // Expired: caller can clean up flags later; we just treat as no penalty.
    return 1;
  }

  // Tunable via env, but with sane clamps.
  const perStackEnv = Number(
    process.env.PW_WALKTO_COWARDICE_DMG_PER_STACK ?? "0.10"
  );
  const perStack = Number.isFinite(perStackEnv)
    ? Math.max(0, Math.min(perStackEnv, 0.50)) // 0–50% per stack
    : 0.10;

  const maxStacksEnv = Number(
    process.env.PW_WALKTO_COWARDICE_MAX_STACKS ?? "10"
  );
  const maxStacks = Number.isFinite(maxStacksEnv)
    ? Math.max(1, Math.min(maxStacksEnv, 50))
    : 10;

  const stacks = Math.max(0, Math.min(stacksRaw, maxStacks));

  const bonusPct = stacks * perStack; // e.g. 3 stacks * 10% = +30% damage taken
  let mult = 1 + bonusPct;

  // Safety rails: don’t go below 10% damage or above 3x
  if (mult < 0.1) mult = 0.1;
  if (mult > 3) mult = 3;

  return mult;
}

/**
 * Core “take damage” helper for players.
 *
 * - Still works fine when called with just (target, amount)
 * - If you pass CharacterState, cowardice stacks increase damage taken.
 */
export function applySimpleDamageToPlayer(
  target: Entity,
  amount: number,
  char?: CharacterState
): SimpleDamageResult {
  const e: any = target;

  const maxHp =
    typeof e.maxHp === "number" && e.maxHp > 0 ? e.maxHp : 100;
  const oldHp =
    typeof e.hp === "number" && e.hp >= 0 ? e.hp : maxHp;

  // Base damage (clamped & floored)
  let dmg = Math.max(0, Math.floor(amount));

  // Risk-mode / cowardice: incoming damage scalar
  const cowardMult = computeCowardiceDamageTakenMultiplier(char);
  if (cowardMult !== 1) {
    dmg = Math.max(0, Math.floor(dmg * cowardMult));
  }

  const newHp = Math.max(0, oldHp - dmg);

  e.maxHp = maxHp;
  e.hp = newHp;

  markInCombat(e);

  let killed = false;
  if (newHp <= 0) {
    killEntity(e);
    killed = true;
  }

  return { newHp, maxHp, killed };
}

/**
 * Shared v1 NPC melee damage formula.
 *
 * - Uses NPC's own power:
 *   - explicit `attackPower` if present
 *   - otherwise ~3% of its own max HP as baseline
 *   - Adds ±20% randomness.
 */
export function computeNpcMeleeDamage(npc: Entity): number {
  const n: any = npc;
  const npcMaxHp =
    typeof n.maxHp === "number" && n.maxHp > 0 ? n.maxHp : 100;

  const base =
    typeof n.attackPower === "number"
      ? n.attackPower
      : Math.max(1, Math.round(npcMaxHp * 0.03)); // ~3% of its own HP

  const roll = 0.8 + Math.random() * 0.4; // ±20%
  const dmg = Math.max(1, Math.floor(base * roll));

  return dmg;
}
