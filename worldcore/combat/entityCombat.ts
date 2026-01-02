// worldcore/combat/entityCombat.ts

import type { Entity } from "../shared/Entity";

function envInt(name: string, fallback: number): number {
  const raw = (process.env[name] ?? "").toString().trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

/**
 * Cowardice penalty (v1):
 *  - Only applies while the debuff is active.
 *  - Stored on the player entity as ephemeral fields (mirrored from CharacterState flags by walkto).
 *
 * Default tuning:
 *  - +8% damage taken per stack, capped at +200%.
 *
 * Env overrides:
 *  - PW_WALKTO_COWARDICE_DMG_TAKEN_PCT_PER_STACK
 *  - PW_WALKTO_COWARDICE_DMG_TAKEN_PCT_MAX
 */
function getCowardiceDamageTakenMultiplier(ent: any): number {
  const stacks = Number(ent?._pw_walktoCowardiceStacks ?? 0);
  const until = Number(ent?._pw_walktoCowardiceUntilMs ?? 0);
  if (!Number.isFinite(stacks) || stacks <= 0) return 1;
  if (!Number.isFinite(until) || Date.now() > until) return 1;

  const pctPerStack = envInt("PW_WALKTO_COWARDICE_DMG_TAKEN_PCT_PER_STACK", 8);
  const pctMax = envInt("PW_WALKTO_COWARDICE_DMG_TAKEN_PCT_MAX", 200);

  const pct = Math.min(
    Math.max(0, pctMax),
    Math.max(0, stacks) * Math.max(0, pctPerStack)
  );
  return 1 + pct / 100;
}

const COMBAT_TAG_MS = 15_000; // 10s “in combat” after hit/damage

export function markInCombat(ent: Entity | any): void {
  (ent as any).inCombatUntil = Date.now() + COMBAT_TAG_MS;
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
}

export interface SimpleDamageResult {
  newHp: number;
  maxHp: number;
  killed: boolean;
}

export function applySimpleDamageToPlayer(
  target: Entity,
  amount: number
): SimpleDamageResult {
  const e: any = target;
  const maxHp = typeof e.maxHp === "number" && e.maxHp > 0 ? e.maxHp : 100;
  const oldHp = typeof e.hp === "number" ? e.hp : maxHp;

  const mult = getCowardiceDamageTakenMultiplier(e);
  const dmg = Math.max(0, Math.floor(amount * mult));
  const newHp = Math.max(0, oldHp - dmg);

  e.maxHp = maxHp;
  e.hp = newHp;

  markInCombat(e);

  // Auto-walk interruption: taking damage cancels walkto unless risk mode is enabled.
  // We don’t check risk mode here; walkto itself decides whether to honor cancellation.
  if (dmg > 0 && e._pw_walktoActive) {
    e._pw_walktoCancelRequestedAtMs = Date.now();
  }

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
 * - Adds ±20% randomness.
 */
export function computeNpcMeleeDamage(npc: Entity): number {
  const n: any = npc;
  const npcMaxHp = typeof n.maxHp === "number" && n.maxHp > 0 ? n.maxHp : 100;

  const base =
    typeof n.attackPower === "number"
      ? n.attackPower
      : Math.max(1, Math.round(npcMaxHp * 0.03)); // ~3% of its own HP

  const roll = 0.8 + Math.random() * 0.4; // ±20%
  const dmg = Math.max(1, Math.floor(base * roll));
  return dmg;
}
