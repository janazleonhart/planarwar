// worldcore/mud/actions/MudCombatActions.ts
//
// Combat actions glue:
// - NPC attacks route through combat/NpcCombat (authoritative-ish, service protection, corpse/respawn).
// - Training dummy uses its own non-lethal HP pool.
// - Player-vs-player damage is NOT generally enabled:
//    * allowed only during an active Duel (consent-based) for now
//    * later: region/plane flags can enable open PvP in specific invasion planes.
//
// This file also provides wrappers that MudActions re-exports (announceSpawnToRoom, performNpcAttack, etc.).

import { MudContext } from "../MudContext";
import type { CharacterState } from "../../characters/CharacterTypes";
import type { Entity } from "../../shared/Entity";
import { resolveTargetInRoom } from "../../targeting/TargetResolver";
import { canDamage } from "../../combat/DamagePolicy";
import { clearStatusEffectsByTags, getActiveStatusEffects } from "../../combat/StatusEffects";

import { computeEffectiveAttributes } from "../../characters/Stats";

import { findTargetPlayerEntityByName } from "../../targeting/targetFinders";
import {
  getTrainingDummyForRoom,
  computeTrainingDummyDamage,
  startTrainingDummyAi,
} from "../MudTrainingDummy";

import { applyProgressionForEvent } from "../MudProgressionHooks";
import { applyProgressionEvent } from "../../progression/ProgressionCore";

import { applySimpleDamageToPlayer, markInCombat, isDeadEntity } from "../../combat/entityCombat";
import { gatePlayerDamageFromPlayerEntity } from "../MudCombatGates";
import { DUEL_SERVICE } from "../../pvp/DuelService";

import {
  performNpcAttack as performNpcAttackCore,
  scheduleNpcCorpseAndRespawn as scheduleNpcCorpseAndRespawnCore,
  announceSpawnToRoom as announceSpawnToRoomCore,
  type NpcAttackOptions,
} from "../../combat/NpcCombat";

export type { NpcAttackOptions } from "../../combat/NpcCombat";

/**
 * Thin wrapper so existing callers keep importing from MudActions.
 *
 * IMPORTANT:
 * Centralize kill progression here so BOTH melee (/attack) and spells (MudSpells -> MudActions -> performNpcAttack)
 * advance kills/titles/tasks/quests consistently.
 */
export async function performNpcAttack(
  ctx: MudContext,
  char: CharacterState,
  selfEntity: Entity,
  npc: Entity,
  opts?: NpcAttackOptions,
): Promise<string> {
  let result = await performNpcAttackCore(ctx, char, selfEntity, npc, opts ?? {});

  // If this line indicates a kill, emit the event then let the hook react.
  // (NpcCombat already handles XP/loot + corpse/respawn scheduling on kill.)
  if (result.includes("You slay")) {
    const protoIdForProgress =
      ctx.npcs?.getNpcStateByEntityId(npc.id)?.protoId ?? npc.name;

    // 1) record the kill in progression
    applyProgressionEvent(char, {
      kind: "kill",
      targetProtoId: protoIdForProgress,
    });

    // 2) react: tasks, quests, titles, xp, DB patch
    try {
      const { snippets } = await applyProgressionForEvent(
        ctx,
        char,
        "kills",
        protoIdForProgress,
      );
      if (snippets.length > 0) {
        result += " " + snippets.join(" ");
      }
    } catch (err) {
      // Never let progression hooks break combat output.
      // eslint-disable-next-line no-console
      console.warn("applyProgressionForEvent (kill) failed", {
        err,
        charId: char.id,
        protoId: protoIdForProgress,
      });
    }
  }

  return result;
}

// Re-exported wrappers for backwards compatibility (MudActions imports these).
export function scheduleNpcCorpseAndRespawn(ctx: MudContext, entityId: string): void {
  return scheduleNpcCorpseAndRespawnCore(ctx, entityId);
}

export function announceSpawnToRoom(ctx: MudContext, roomId: string, text: string): void {
  return announceSpawnToRoomCore(ctx, roomId, text);
}

// --- Stealth integration (combat/threat/engage) ---
// Stealth is represented as a status-effect tag on the CharacterState.
// We reveal (break stealth) on ANY hostile melee commit to prevent threat/assist leakage.
function ensureStatusEffectsSpineForCombat(char: CharacterState): void {
  const anyChar: any = char as any;
  if (!anyChar.progression || typeof anyChar.progression !== "object") anyChar.progression = {};
  const prog: any = anyChar.progression;
  if (!prog.statusEffects || typeof prog.statusEffects !== "object") prog.statusEffects = {};
  const se: any = prog.statusEffects;
  if (!se.active || typeof se.active !== "object") se.active = {};
}

function isStealthedForCombat(char: CharacterState): boolean {
  try {
    const active = getActiveStatusEffects(char as any);
    return active.some((e: any) => Array.isArray(e?.tags) && e.tags.includes("stealth"));
  } catch {
    return false;
  }
}

function dropStatusTagFromActiveForCombat(char: CharacterState, tag: string): void {
  ensureStatusEffectsSpineForCombat(char);
  const needle = String(tag ?? "").toLowerCase().trim();
  if (!needle) return;
  const activeMap: Record<string, any> = ((char as any).progression.statusEffects.active ?? {}) as any;
  for (const [k, v] of Object.entries(activeMap)) {
    const tags: any[] = Array.isArray((v as any)?.tags) ? (v as any).tags : [];
    if (tags.some((t) => String(t).toLowerCase().trim() === needle)) {
      delete (activeMap as any)[k];
    }
  }
}

function breakStealthForCombat(char: CharacterState): void {
  // Clear any active status effects with the "stealth" tag.
  ensureStatusEffectsSpineForCombat(char);
  clearStatusEffectsByTags(char as any, ["stealth"], Number.MAX_SAFE_INTEGER);
  // Defensive: if anything injected directly, ensure the tag is removed from the active map too.
  dropStatusTagFromActiveForCombat(char, "stealth");
}

function envNumber(name: string, fallback: number): number {
  const raw = String((process.env as any)?.[name] ?? "").trim();
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function clampNumber(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// Damage multiplier applied to the first melee action performed while stealthed.
const PW_STEALTH_OPENER_DAMAGE_MULT = clampNumber(envNumber("PW_STEALTH_OPENER_DAMAGE_MULT", 1.35), 1.0, 5.0);

// ---------------------------------------------------------------------------
// Shared attack handler used by MUD attack command.
// ---------------------------------------------------------------------------


// ---- Engaged target tracking ------------------------------------------------
//
// We store the engaged target on the *player entity* (not the character state)
// because:
// - it is room-scoped combat intent (not persistent player data)
// - it naturally resets on respawn / rehydrate
//
// Convention:
//   (playerEntity as any).engagedTargetId?: string
//
// This is used by "auto-attack intent" (attack with no explicit target).

function getEntitiesInRoomSafe(entities: any, roomId: string): any[] {
  const rid = String(roomId ?? "");
  if (!rid) return [];

  try {
    const fn = entities?.getEntitiesInRoom;
    if (typeof fn === "function") {
      const out = fn.call(entities, rid);
      return Array.isArray(out) ? out : [];
    }
  } catch {
    // fall through
  }

  try {
    const fn = entities?.getAll;
    if (typeof fn === "function") {
      const all = fn.call(entities);
      const arr = Array.isArray(all) ? all : Array.from(all ?? []);
      return arr.filter((e: any) => String(e?.roomId ?? "") === rid);
    }
  } catch {
    // fall through
  }

  return [];
}

function getEngagedTargetInRoom(ctx: MudContext, selfEntity: any): any | null {
  const roomId = String(selfEntity?.roomId ?? "");
  if (!roomId) return null;

  const engagedId = String((selfEntity as any)?.engagedTargetId ?? "").trim();
  if (!engagedId) return null;

  const roomEnts = getEntitiesInRoomSafe(ctx.entities, roomId);
  for (const e of roomEnts) {
    if (String((e as any)?.id ?? "") === engagedId) return e;
  }

  return null;
}

function clearEngagedTarget(selfEntity: any): void {
  try {
    delete (selfEntity as any).engagedTargetId;
  } catch {
    (selfEntity as any).engagedTargetId = undefined;
  }
}

function setEngagedTarget(selfEntity: any, targetEntity: any): void {
  const tid = String((targetEntity as any)?.id ?? "").trim();
  if (!tid) return;
  (selfEntity as any).engagedTargetId = tid;
}

// ---------------------------------------------------------------------------
// Shared attack handler used by MUD attack command.
// ---------------------------------------------------------------------------

export async function handleAttackAction(
  ctx: MudContext,
  char: CharacterState,
  targetNameRaw: string,
): Promise<string> {
  const targetName = (targetNameRaw ?? "").trim();

  if (!ctx.entities) return "Combat is not available here (no entity manager).";

  const selfEntity = ctx.entities.getEntityByOwner(ctx.session.id);
  if (!selfEntity) return "You have no body here.";

  const world = ctx.world;
  if (!world) return "The world is not initialized yet.";

  const roomId = selfEntity.roomId ?? char.shardId;

  const wasStealthed = isStealthedForCombat(char);
  const openerMult = wasStealthed ? PW_STEALTH_OPENER_DAMAGE_MULT : 1;

  // --- Auto-attack intent (no explicit target) ---
  // Deny-by-default to prevent room-cleave bugs.
  // Only allowed if the player already has an engaged target in this room.
  let engagedTarget: any | null = null;
  if (!targetName) {
    engagedTarget = getEngagedTargetInRoom(ctx, selfEntity);

    if (!engagedTarget) {
      // If we had an engagedTargetId but it no longer exists, clear it.
      const hadId = String((selfEntity as any)?.engagedTargetId ?? "").trim();
      if (hadId) clearEngagedTarget(selfEntity);

      return "[combat] You are not engaged with a target.";
    }

    if (isDeadEntity(engagedTarget) || engagedTarget.alive === false) {
      clearEngagedTarget(selfEntity);
      return "[combat] Your engaged target is already dead.";
    }
  }

  // 1) NPC target (rats, ore, dummies, etc.)
  const npcTarget = engagedTarget && (engagedTarget.type === "npc" || engagedTarget.type === "mob")
    ? engagedTarget
    : resolveTargetInRoom(ctx.entities as any, roomId, targetNameRaw, {
        selfId: selfEntity.id,
        filter: (e: any) => e?.type === "npc" || e?.type === "mob",
        radius: 30,
      });

  if (npcTarget) {
    // Engage this target (for subsequent attack-with-no-args swings).
    setEngagedTarget(selfEntity, npcTarget);

    // Prevent double-kills / double-loot / double-respawn scheduling.
    if ((npcTarget as any).alive === false) {
      return `That is already dead.`;
    }

    const npcState = ctx.npcs?.getNpcStateByEntityId((npcTarget as any).id);
    const protoId = npcState?.protoId;

    // Training dummy: use the non-lethal dummy HP pool and NEVER route through NpcCombat
    // (so the dummy doesn't fight back via NPC AI).
    if (protoId === "training_dummy_big") {
      const dummyInstance = getTrainingDummyForRoom(roomId);

      if (wasStealthed) breakStealthForCombat(char);

      if (wasStealthed) breakStealthForCombat(char);

    markInCombat(selfEntity);
      markInCombat(dummyInstance as any);
      startTrainingDummyAi(ctx, ctx.session.id, roomId);

      const effective = computeEffectiveAttributes(char, ctx.items);
      const baseDmg = computeTrainingDummyDamage(effective);
      const dmg = Math.max(1, Math.round(baseDmg * openerMult));

      dummyInstance.hp = Math.max(0, dummyInstance.hp - dmg);

      if (dummyInstance.hp > 0) {
        return (
          `[combat] You hit the Training Dummy for ${dmg} damage. ` +
          `(${dummyInstance.hp}/${dummyInstance.maxHp} HP)`
        );
      }

      const line =
        `[combat] You obliterate the Training Dummy for ${dmg} damage! ` +
        `(0/${dummyInstance.maxHp} HP – it quickly knits itself back together.)`;
      dummyInstance.hp = dummyInstance.maxHp;
      return line;
    }

    // Normal NPC attack flow.
    // Kill progression is centralized inside performNpcAttack(...) above.
    if (wasStealthed) breakStealthForCombat(char);
    return await performNpcAttack(ctx, char, selfEntity as any, npcTarget as any, wasStealthed ? { damageMultiplier: openerMult } : undefined);
  }

  // 2) Player target – duel-gated PvP (open PvP zones can come later).
  const playerTarget: any =
    engagedTarget && engagedTarget.type === "player"
      ? engagedTarget
      : (() => {
          const found = findTargetPlayerEntityByName(ctx, roomId, targetNameRaw);
          const ent = found ? (found as any).entity ?? found : null;
          return ent;
        })();

  const playerTargetName: string =
    (playerTarget as any)?.name ?? targetNameRaw;

  if (playerTarget) {
    // Engage this target for subsequent swings.
    setEngagedTarget(selfEntity, playerTarget);

    const gateRes = await gatePlayerDamageFromPlayerEntity(ctx, char, roomId, playerTarget);
    if (!gateRes.allowed) {
      return gateRes.reason;
    }

    const { now, label, mode: ctxMode, targetChar, targetSession } = gateRes;

    // Lane D: async DamagePolicy backstop for player-vs-player damage.
    // gatePlayerDamageFromPlayerEntity enforces duel consent; this enforces region combat/PvP flags + service protection.
    try {
      const policy = await canDamage(
        { entity: selfEntity as any, char },
        { entity: playerTarget as any, char: targetChar as any },
        { shardId: char.shardId, regionId: roomId, inDuel: ctxMode === "duel" },
      );
      if (policy && policy.allowed === false) {
        return policy.reason ?? "You cannot attack here.";
      }
    } catch {
      // Best-effort: never let policy lookup crash melee.
    }

    const effective = computeEffectiveAttributes(char, ctx.items);
    const baseDmg = computeTrainingDummyDamage(effective);
    const dmg = Math.max(1, Math.round(baseDmg * openerMult));

    const { newHp, maxHp, killed } = applySimpleDamageToPlayer(
      playerTarget as any,
      dmg,
      targetChar as any,
      "physical",
      { mode: ctxMode },
    );

    markInCombat(selfEntity);
    markInCombat(playerTarget as any);

    // Notify the target (best-effort).
    if (targetSession && ctx.sessions) {
      ctx.sessions.send(targetSession as any, "chat", {
        from: "[world]",
        sessionId: "system",
        text: killed
          ? `[${label}] ${selfEntity.name} hits you for ${dmg} damage. You fall. (0/${maxHp} HP)`
          : `[${label}] ${selfEntity.name} hits you for ${dmg} damage. (${newHp}/${maxHp} HP)`,
        t: now,
      });
    }

    if (killed) {
      // Skeleton rule: duel ends on death.
      if (ctxMode === "duel") DUEL_SERVICE.endDuelFor(char.id, "death", now);
      return `[${label}] You hit ${playerTargetName} for ${dmg} damage. You defeat them. (0/${maxHp} HP)`;
    }

    return `[${label}] You hit ${playerTargetName} for ${dmg} damage. (${newHp}/${maxHp} HP)`;
  }

  // 3) Fallback: name-only training dummy (if no NPC entity was matched)
  if (targetName.toLowerCase().includes("dummy")) {
    const dummyInstance = getTrainingDummyForRoom(roomId);

    markInCombat(selfEntity);
    markInCombat(dummyInstance as any);
    startTrainingDummyAi(ctx, ctx.session.id, roomId);

    const effective = computeEffectiveAttributes(char, ctx.items);
    const baseDmg = computeTrainingDummyDamage(effective);
    const dmg = Math.max(1, Math.round(baseDmg * openerMult));

    dummyInstance.hp = Math.max(0, dummyInstance.hp - dmg);

    if (dummyInstance.hp > 0) {
      return (
        `[combat] You hit the Training Dummy for ${dmg} damage. ` +
        `(${dummyInstance.hp}/${dummyInstance.maxHp} HP)`
      );
    }

    const line =
      `[combat] You obliterate the Training Dummy for ${dmg} damage! ` +
      `(0/${dummyInstance.maxHp} HP – it quickly knits itself back together.)`;
    dummyInstance.hp = dummyInstance.maxHp;
    return line;
  }

  // 4) No valid target.
  return `[world] No such target: '${targetNameRaw}'.`;
}

// ---------------------------------------------------------------------------
// Ranged attack handler (v1)
// ---------------------------------------------------------------------------
//
// Philosophy:
// - Ranged is an explicit verb (shoot/throw/fire) so we don't accidentally
//   change existing melee semantics.
// - We enforce simple constraints that make “ranger” viable without turning
//   combat into a geometry exploit-fest:
//   * max range
//   * simple line-of-sight: target must be within a forward cone
// - Ammo, projectile travel time, and cover are later.

function distanceXZ(a: any, b: any): number {
  const ax = Number((a as any)?.x ?? 0);
  const az = Number((a as any)?.z ?? 0);
  const bx = Number((b as any)?.x ?? 0);
  const bz = Number((b as any)?.z ?? 0);
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function normalizeAngleRad(r: number): number {
  let x = r;
  while (x <= -Math.PI) x += Math.PI * 2;
  while (x > Math.PI) x -= Math.PI * 2;
  return x;
}

function getRotYRadSafe(e: any): number {
  const v = Number((e as any)?.rotY ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function canSeeTargetForwardCone(selfEntity: any, targetEntity: any, fovDeg: number): boolean {
  const fov = Math.max(1, Math.min(360, Number(fovDeg ?? 120)));
  const half = (fov * Math.PI) / 360;

  const sx = Number((selfEntity as any)?.x ?? 0);
  const sz = Number((selfEntity as any)?.z ?? 0);
  const tx = Number((targetEntity as any)?.x ?? 0);
  const tz = Number((targetEntity as any)?.z ?? 0);

  const dx = tx - sx;
  const dz = tz - sz;

  // Degenerate: same point -> "visible".
  if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return true;

  // In this coordinate system, we treat +Z as "forward" when rotY = 0.
  const toTargetYaw = Math.atan2(dx, dz);
  const selfYaw = getRotYRadSafe(selfEntity);
  const delta = normalizeAngleRad(toTargetYaw - selfYaw);

  return Math.abs(delta) <= half;
}

function envRange(name: string, fallback: number): number {
  const raw = String((process.env as any)?.[name] ?? "").trim();
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function getRangedMaxRange(): number {
  return clampNumber(envRange("PW_RANGED_MAX_RANGE", 14), 4, 60);
}

function getRangedFovDeg(): number {
  return clampNumber(envRange("PW_RANGED_FOV_DEG", 140), 30, 360);
}

export async function handleRangedAttackAction(
  ctx: MudContext,
  char: CharacterState,
  targetNameRaw: string,
): Promise<string> {
  const targetName = (targetNameRaw ?? "").trim();
  if (!targetName) return "[combat] Usage: shoot <target>";

  if (!ctx.entities) return "Combat is not available here (no entity manager).";

  const selfEntity = ctx.entities.getEntityByOwner(ctx.session.id);
  if (!selfEntity) return "You have no body here.";

  const roomId = (selfEntity as any).roomId ?? char.shardId;

  // Resolve NPC target (v1: same-room only).
  const npcTarget = resolveTargetInRoom(ctx.entities as any, roomId, targetNameRaw, {
    selfId: selfEntity.id,
    filter: (e: any) => e?.type === "npc" || e?.type === "mob",
    radius: getRangedMaxRange(),
  });

  // Resolve player target (duel-gated PvP) if no NPC matched.
  const playerTarget: any =
    npcTarget
      ? null
      : (() => {
          const found = findTargetPlayerEntityByName(ctx, roomId, targetNameRaw);
          const ent = found ? (found as any).entity ?? found : null;
          return ent;
        })();

  const targetEntity: any = npcTarget ?? playerTarget;
  if (!targetEntity) return `[world] No such target: '${targetNameRaw}'.`;

  if (isDeadEntity(targetEntity) || (targetEntity as any).alive === false) {
    return "[combat] That target is already dead.";
  }

  // Range check (2D XZ)
  const dist = distanceXZ(selfEntity, targetEntity);
  if (dist > getRangedMaxRange() + 1e-6) {
    return `[combat] ${targetEntity.name} is out of range.`;
  }

  // Line-of-sight (v1): forward cone
  if (!canSeeTargetForwardCone(selfEntity, targetEntity, getRangedFovDeg())) {
    return `[combat] You don't have line of sight to ${targetEntity.name}.`;
  }

  // Break stealth on hostile commit.
  const wasStealthed = isStealthedForCombat(char);
  if (wasStealthed) breakStealthForCombat(char);

  // Engage for subsequent melee swings (quality-of-life)
  setEngagedTarget(selfEntity, targetEntity);

  // NPCs: route through the same authoritative-ish pipeline.
  if (npcTarget) {
    // Training dummy ranged uses the dummy HP pool too.
    const npcState = ctx.npcs?.getNpcStateByEntityId((npcTarget as any).id);
    const protoId = npcState?.protoId;

    if (protoId === "training_dummy_big") {
      const dummyInstance = getTrainingDummyForRoom(roomId);

      markInCombat(selfEntity);
      markInCombat(dummyInstance as any);
      startTrainingDummyAi(ctx, ctx.session.id, roomId);

      const effective = computeEffectiveAttributes(char, ctx.items);
      const baseDmg = computeTrainingDummyDamage(effective);
      const dmg = Math.max(1, Math.round(baseDmg));

      dummyInstance.hp = Math.max(0, dummyInstance.hp - dmg);

      if (dummyInstance.hp > 0) {
        return (
          `[combat] You shoot the Training Dummy for ${dmg} damage. ` +
          `(${dummyInstance.hp}/${dummyInstance.maxHp} HP)`
        );
      }

      const line =
        `[combat] You shoot the Training Dummy for ${dmg} damage! ` +
        `(0/${dummyInstance.maxHp} HP – it quickly knits itself back together.)`;
      dummyInstance.hp = dummyInstance.maxHp;
      return line;
    }

    return await performNpcAttack(ctx, char, selfEntity as any, npcTarget as any, {
      // v1: ranged uses same damage model; later: weapon/ranged skill, ammo, falloff.
    });
  }

  // Players: duel-gated PvP with additional DamagePolicy backstop.
  if (playerTarget) {
    const gateRes = await gatePlayerDamageFromPlayerEntity(ctx, char, roomId, playerTarget);
    if (!gateRes.allowed) return gateRes.reason;

    const { now, label, mode: ctxMode, targetChar, targetSession } = gateRes;

    try {
      const policy = await canDamage(
        { entity: selfEntity as any, char },
        { entity: playerTarget as any, char: targetChar as any },
        { shardId: char.shardId, regionId: roomId, inDuel: ctxMode === "duel" },
      );
      if (policy && policy.allowed === false) return policy.reason ?? "You cannot attack here.";
    } catch {
      // ignore
    }

    const effective = computeEffectiveAttributes(char, ctx.items);
    const baseDmg = computeTrainingDummyDamage(effective);
    const dmg = Math.max(1, Math.round(baseDmg));

    const { newHp, maxHp, killed } = applySimpleDamageToPlayer(
      playerTarget as any,
      dmg,
      targetChar as any,
      "physical",
      { mode: ctxMode },
    );

    markInCombat(selfEntity);
    markInCombat(playerTarget as any);

    if (targetSession && ctx.sessions) {
      ctx.sessions.send(targetSession as any, "chat", {
        from: "[world]",
        sessionId: "system",
        text: killed
          ? `[${label}] ${selfEntity.name} shoots you for ${dmg} damage. You fall. (0/${maxHp} HP)`
          : `[${label}] ${selfEntity.name} shoots you for ${dmg} damage. (${newHp}/${maxHp} HP)`,
        t: now,
      });
    }

    if (killed) {
      if (ctxMode === "duel") DUEL_SERVICE.endDuelFor(char.id, "death", now);
      return `[${label}] You shoot ${playerTarget.name} for ${dmg} damage. You defeat them. (0/${maxHp} HP)`;
    }

    return `[${label}] You shoot ${playerTarget.name} for ${dmg} damage. (${newHp}/${maxHp} HP)`;
  }

  return "[world] No such target.";
}


// ---------------------------------------------------------------------------
// Taunt handler (threat override).
// ---------------------------------------------------------------------------

export async function handleTauntAction(
  ctx: MudContext,
  char: CharacterState,
  targetNameRaw: string,
): Promise<string> {
  const targetName = (targetNameRaw ?? "").trim();

  if (!ctx.entities) return "Combat is not available here (no entity manager).";

  const selfEntity = ctx.entities.getEntityByOwner(ctx.session.id);
  if (!selfEntity) return "You have no body here.";

  const roomId = (selfEntity as any).roomId ?? char.shardId;

  // If no explicit target, use engaged target (deny-by-default).
  let target: any | null = null;
  if (!targetName) {
    target = getEngagedTargetInRoom(ctx, selfEntity);
    if (!target) {
      const hadId = String((selfEntity as any)?.engagedTargetId ?? "").trim();
      if (hadId) clearEngagedTarget(selfEntity);
      return "[combat] You are not engaged with a target.";
    }
  }

  // Resolve NPC target in room if needed
  const npcTarget =
    target && (target.type === "npc" || target.type === "mob")
      ? target
      : resolveTargetInRoom(ctx.entities as any, roomId, targetNameRaw, {
          selfId: selfEntity.id,
          filter: (e: any) => e?.type === "npc" || e?.type === "mob",
          radius: 30,
        });

  if (!npcTarget) {
    return "No such target.";
  }

  if (isDeadEntity(npcTarget) || (npcTarget as any).alive === false) {
    clearEngagedTarget(selfEntity);
    return "[combat] That target is already dead.";
  }

  // Engage for subsequent `attack` with no args
  setEngagedTarget(selfEntity, npcTarget);

  if (!ctx.npcs || typeof ctx.npcs.taunt !== "function") {
    return "Taunt is not available (NPC manager not wired).";
  }

  const ok = ctx.npcs.taunt(npcTarget.id, selfEntity.id, { durationMs: 4000, threatBoost: 10 });
  if (!ok) {
    return "[combat] That target cannot be taunted.";
  }

  return `[combat] You taunt ${npcTarget.name}.`;
}
