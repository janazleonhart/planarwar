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
import { applyRankKillGrantsForKill } from "../../ranks/RankKillGrantService";

import { applySimpleDamageToPlayer, markInCombat, isDeadEntity } from "../../combat/entityCombat";
import { gatePlayerDamageFromPlayerEntity } from "../MudCombatGates";
import { DUEL_SERVICE } from "../../pvp/DuelService";

import { resolvePhysicalHit, type PhysicalHitResult } from "../../combat/PhysicalHitResolver";

import { computeDamage } from "../../combat/CombatEngine";

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

      // 3) rank kill-grants (Rank system v0.2)
      try {
        const r = await applyRankKillGrantsForKill(ctx, char, protoIdForProgress);
        if (r.snippets.length > 0) {
          result += " " + r.snippets.join(" ");
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("applyRankKillGrantsForKill failed", { err, charId: char.id, protoId: protoIdForProgress });
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

function getCharacterForPlayerEntity(ctx: MudContext, ent: any): CharacterState | null {
  try {
    const sid = String((ent as any)?.ownerSessionId ?? "").trim();
    if (!sid) return null;
    const s: any = (ctx as any)?.sessions?.get?.(sid) ?? null;
    const c: any = s?.character ?? s?.char ?? null;
    return c && c.id ? (c as any) : null;
  } catch {
    return null;
  }
}

function isStealthedPlayerEntityForViewer(ctx: MudContext, ent: any): boolean {
  const t = String((ent as any)?.type ?? "").toLowerCase();
  if (t !== "player") return false;
  const c = getCharacterForPlayerEntity(ctx, ent);
  if (!c) return false;
  return isStealthedForCombat(c as any);
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

function getWeaponSkillPointsForChar(char: CharacterState): number {
  // v0: many classes don't track weapon skills yet. When present, prefer it.
  const anyChar: any = char as any;
  const v =
    anyChar?.progression?.weaponSkills?.melee ??
    anyChar?.progression?.skills?.melee ??
    anyChar?.progression?.skills?.weaponSkillPoints ??
    0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function getDefenseSkillPointsForChar(char: CharacterState): number {
  const anyChar: any = char as any;
  const v = anyChar?.progression?.skills?.defense ?? anyChar?.progression?.skills?.defenseSkillPoints ?? 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

export function computeDuelMeleeDamageFromPhysicalResult(args: {
  baseDamage: number;
  openerMultiplier: number;
  phys: PhysicalHitResult;
  riposteBaseDamage?: number;
  rng?: () => number;
}): { outcome: PhysicalHitResult["outcome"]; damageToTarget: number; didRiposte: boolean; riposteDamage: number } {
  const rng = args.rng ?? Math.random;

  const base = Math.max(0, Number(args.baseDamage) || 0);
  const openerMult = Number.isFinite(args.openerMultiplier) ? args.openerMultiplier : 1;

  const outcome = args.phys.outcome;
  if (outcome === "miss" || outcome === "dodge" || outcome === "parry") {
    const didRiposte = outcome === "parry" && !!args.phys.riposte;
    let riposteDamage = 0;
    if (didRiposte) {
      const riposteChance = clamp01(envNumber("PW_RIPOSTE_CHANCE_ON_PARRY", 0.3));
      if (rng() < riposteChance) {
        const ripMult = clamp(envNumber("PW_RIPOSTE_DAMAGE_MULTIPLIER", 0.5), 0, 5);
        const ripBase = Math.max(0, Number(args.riposteBaseDamage) || base);
        riposteDamage = Math.max(1, Math.round(ripBase * ripMult));
      }
    }
    return { outcome, damageToTarget: 0, didRiposte: riposteDamage > 0, riposteDamage };
  }

  // hit/block
  const blockMult = outcome === "block" ? clamp(args.phys.blockMultiplier, 0, 1) : 1;
  const dmg = Math.max(1, Math.round(base * openerMult * blockMult));
  return { outcome, damageToTarget: dmg, didRiposte: false, riposteDamage: 0 };
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

function isTestEnv(): boolean {
  return (
    process.env.WORLDCORE_TEST === "1" ||
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    (process.env as any).JEST_WORKER_ID !== undefined
  );
}

// In tests, keep CombatEngine deterministic by feeding a stable RNG value that yields roll=1.0.
// (computeDamage uses roll = 0.8 + rng()*0.4, so rng=0.5 => roll=1.0)
function combatRng(): () => number {
  return isTestEnv() ? (() => 0.5) : Math.random;
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

    // If the engaged target is a stealthed player, treat it as non-existent (no free "track").
    if (engagedTarget && isStealthedPlayerEntityForViewer(ctx, engagedTarget)) {
      clearEngagedTarget(selfEntity);
      return "[combat] You cannot see that target.";
    }

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

    markInCombat(selfEntity);
      markInCombat(dummyInstance as any);
      startTrainingDummyAi(ctx, ctx.session.id, roomId);

      const effective = computeEffectiveAttributes(char, ctx.items);
      const baseDmg = computeTrainingDummyDamage(effective);
      const roll = computeDamage(
        { char, effective, channel: "weapon" },
        { entity: npcTarget as any },
        { basePower: baseDmg, damageMultiplier: openerMult, damageSchool: "physical", rng: combatRng() },
      );
      const dmg = Math.max(1, roll.damage);

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

    // Stealth: you can't directly target a stealthed player (deny before damage/cooldowns).
    if (isStealthedForCombat(gateRes.targetChar as any)) {
      clearEngagedTarget(selfEntity);
      return "[combat] You cannot see that target.";
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

    const rng = typeof (ctx as any).combatRng === "function" ? ((ctx as any).combatRng as any) : combatRng();

    const phys = resolvePhysicalHit({
      attackerLevel: Number((char as any).level) || 1,
      defenderLevel: Number((targetChar as any).level) || 1,
      weaponSkillPoints: getWeaponSkillPointsForChar(char),
      defenderDefenseSkillPoints: getDefenseSkillPointsForChar(targetChar as any),
      defenderCanDodge: true,
      defenderCanParry: true,
      defenderCanBlock: true,
      allowCrit: true,
      allowMultiStrike: false,
      allowRiposte: true,
      rng,
    });

    const targetEffective = computeEffectiveAttributes(targetChar as any, ctx.items);
    const riposteBase = computeTrainingDummyDamage(targetEffective);

    // Unify duel melee damage through CombatEngine for hit/block outcomes.
    // Miss/dodge/parry are still resolved by PhysicalHitResolver (including optional riposte).
    let outcome: PhysicalHitResult["outcome"] = phys.outcome;
    let dmg = 0;
    let riposteDamage = 0;

    if (outcome === "miss" || outcome === "dodge" || outcome === "parry") {
      if (outcome === "parry" && phys.riposte) {
        const riposteChance = clamp01(envNumber("PW_RIPOSTE_CHANCE_ON_PARRY", 0.3));
        if (rng() < riposteChance) {
          const ripMult = clamp(envNumber("PW_RIPOSTE_DAMAGE_MULTIPLIER", 0.5), 0, 5);
          // Use defender's baseline as the riposte base (keeps symmetry with earlier v1 behavior).
          riposteDamage = Math.max(1, Math.round(riposteBase * ripMult));
        }
      }
    } else {
      const roll = computeDamage(
        { char, effective, channel: "weapon" },
        { entity: playerTarget as any },
        {
          basePower: baseDmg,
          damageMultiplier: openerMult,
          damageSchool: "physical",
          rng,
          critChance: phys.critChance,
          glancingChance: phys.glancingChance,
        },
      );

      dmg = Math.max(1, roll.damage);

      if (outcome === "block") {
        const blockMult = clamp(phys.blockMultiplier, 0, 1);
        dmg = Math.max(1, Math.round(dmg * blockMult));
      }
    }

    const duelCalc = { outcome, damageToTarget: dmg, didRiposte: riposteDamage > 0, riposteDamage };

    const { newHp, maxHp, killed } = dmg > 0
      ? applySimpleDamageToPlayer(
          playerTarget as any,
          dmg,
          targetChar as any,
          "physical",
          { mode: ctxMode },
        )
      : { newHp: (playerTarget as any).hp, maxHp: (playerTarget as any).maxHp, killed: false };

    markInCombat(selfEntity);
    markInCombat(playerTarget as any);

    // Notify the target (best-effort).
    if (targetSession && ctx.sessions) {
      ctx.sessions.send(targetSession as any, "chat", {
        from: "[world]",
        sessionId: "system",
        text: duelCalc.outcome === "miss"
          ? `[${label}] ${selfEntity.name} swings and misses you.`
          : duelCalc.outcome === "dodge"
          ? `[${label}] You dodge ${selfEntity.name}'s attack.`
          : duelCalc.outcome === "parry"
          ? `[${label}] You parry ${selfEntity.name}'s attack.`
          : duelCalc.outcome === "block"
          ? killed
            ? `[${label}] ${selfEntity.name} hits you (blocked) for ${dmg} damage. You fall. (0/${maxHp} HP)`
            : `[${label}] ${selfEntity.name} hits you (blocked) for ${dmg} damage. (${newHp}/${maxHp} HP)`
          : killed
          ? `[${label}] ${selfEntity.name} hits you for ${dmg} damage. You fall. (0/${maxHp} HP)`
          : `[${label}] ${selfEntity.name} hits you for ${dmg} damage. (${newHp}/${maxHp} HP)`,
        t: now,
      });
    }

    // Parry->riposte (best-effort): apply damage back to the attacker and notify both.
    if (duelCalc.riposteDamage > 0) {
      const selfChar: any = char as any;
      const { newHp: selfNewHp, maxHp: selfMaxHp, killed: selfKilled } = applySimpleDamageToPlayer(
        selfEntity as any,
        duelCalc.riposteDamage,
        selfChar,
        "physical",
        { mode: ctxMode },
      );

      // Notify attacker (best-effort).
      try {
        ctx.sessions?.send?.(ctx.session as any, "chat", {
          from: "[world]",
          sessionId: "system",
          text: selfKilled
            ? `[${label}] ${playerTargetName} ripostes you for ${duelCalc.riposteDamage} damage. You fall. (0/${selfMaxHp} HP)`
            : `[${label}] ${playerTargetName} ripostes you for ${duelCalc.riposteDamage} damage. (${selfNewHp}/${selfMaxHp} HP)`,
          t: now,
        });
      } catch {
        // ignore
      }

      // Notify defender.
      if (targetSession && ctx.sessions) {
        ctx.sessions.send(targetSession as any, "chat", {
          from: "[world]",
          sessionId: "system",
          text: `[${label}] You riposte ${selfEntity.name} for ${duelCalc.riposteDamage} damage.`,
          t: now,
        });
      }

      if (selfKilled && ctxMode === "duel") {
        DUEL_SERVICE.endDuelFor(char.id, "death", now);
        return `[${label}] ${playerTargetName} ripostes you for ${duelCalc.riposteDamage} damage. You are defeated. (0/${selfMaxHp} HP)`;
      }
    }

    if (killed) {
      // Skeleton rule: duel ends on death.
      if (ctxMode === "duel") DUEL_SERVICE.endDuelFor(char.id, "death", now);
      return `[${label}] You hit ${playerTargetName} for ${dmg} damage. You defeat them. (0/${maxHp} HP)`;
    }

    if (dmg <= 0) {
      if (duelCalc.outcome === "miss") return `[${label}] You miss ${playerTargetName}.`;
      if (duelCalc.outcome === "dodge") return `[${label}] ${playerTargetName} dodges your attack.`;
      if (duelCalc.outcome === "parry") return `[${label}] ${playerTargetName} parries your attack.`;
      return `[${label}] You fail to harm ${playerTargetName}.`;
    }

    const suffix = duelCalc.outcome === "block" ? " (blocked)" : "";
    return `[${label}] You hit ${playerTargetName}${suffix} for ${dmg} damage. (${newHp}/${maxHp} HP)`;
  }

  // 3) Fallback: name-only training dummy (if no NPC entity was matched)
  if (targetName.toLowerCase().includes("dummy")) {
    const dummyInstance = getTrainingDummyForRoom(roomId);

    markInCombat(selfEntity);
    markInCombat(dummyInstance as any);
    startTrainingDummyAi(ctx, ctx.session.id, roomId);

    const effective = computeEffectiveAttributes(char, ctx.items);
    const baseDmg = computeTrainingDummyDamage(effective);
    const roll = computeDamage(
      { char, effective, channel: "weapon" },
      { entity: { id: "training_dummy", name: "Training Dummy", type: "npc" } as any },
      { basePower: baseDmg, damageMultiplier: openerMult, damageSchool: "physical", rng: combatRng() },
    );
    const dmg = Math.max(1, roll.damage);

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
  // 360° means "don't require facing" (room LoS is handled elsewhere in the
  // future; for now we treat this as always-visible).
  if (fov >= 359.999) return true;
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
  // Default is 360 so ranged works naturally without forcing the player to
  // face a target just to shoot it. Contract tests can override this to validate
  // "target behind you" denial.
  return clampNumber(envRange("PW_RANGED_FOV_DEG", 360), 30, 360);
}

function getRangedDamageBaseCadenceMs(): number {
  // Reference cadence used to normalize per-shot damage scaling.
  // Defaults to PW_AUTOFIRE_MS (if present) so early balance knobs stay coherent.
  const fallback = envRange("PW_AUTOFIRE_MS", 2000);
  return clampNumber(envRange("PW_RANGED_DAMAGE_BASE_CADENCE_MS", fallback), 10, 20000);
}

function getRangedDamageScaleMin(): number {
  return clampNumber(envRange("PW_RANGED_DAMAGE_SCALE_MIN", 0.5), 0.05, 10);
}

function getRangedDamageScaleMax(): number {
  return clampNumber(envRange("PW_RANGED_DAMAGE_SCALE_MAX", 2.0), 0.05, 10);
}

function readWeaponSpeedMsFromItemStack(stack: any): number | null {
  if (!stack) return null;
  const meta = (stack as any).meta ?? {};
  const candidates = [
    meta.speedMs,
    meta.weaponSpeedMs,
    meta.cadenceMs,
    meta.attackSpeedMs,
    meta?.weapon?.speedMs,
    meta?.weapon?.speed_ms,
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function readRangedWeaponSpeedMs(char: CharacterState): number | null {
  const eq: any = (char as any)?.equipment ?? {};
  const candidates = [eq.ranged, eq.range, eq.weapon_ranged, eq.rangedWeapon];
  for (const s of candidates) {
    const n = readWeaponSpeedMsFromItemStack(s);
    if (n != null) return n;
  }

  const statCandidates = [
    (char as any)?.attributes?.rangedWeaponSpeedMs,
    (char as any)?.attributes?.rangedSpeedMs,
    (char as any)?.progression?.combat?.rangedSpeedMs,
  ];
  for (const v of statCandidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return null;
}

/**
 * Damage scale applied to ranged per-shot damage so weapon speed changes cadence feel
 * without turning the fastest weapon into the highest DPS.
 *
 * scale = clamp(weaponSpeedMs / baseCadenceMs, minScale, maxScale)
 */
function getRangedDamageScaleForCharacter(char: CharacterState): number {
  const weaponMs = readRangedWeaponSpeedMs(char);
  if (weaponMs == null) return 1;

  const base = getRangedDamageBaseCadenceMs();
  const minS = getRangedDamageScaleMin();
  const maxS = Math.max(minS, getRangedDamageScaleMax());

  const raw = weaponMs / Math.max(1, base);
  return clampNumber(raw, minS, maxS);
}

export async function handleRangedAttackAction(
  ctx: MudContext,
  char: CharacterState,
  targetNameRaw: string,
): Promise<string> {
  const targetName = (targetNameRaw ?? "").trim();

  if (!ctx.entities) return "Combat is not available here (no entity manager).";

  const selfEntity = ctx.entities.getEntityByOwner(ctx.session.id);
  if (!selfEntity) return "You have no body here.";

  const roomId = (selfEntity as any).roomId ?? char.shardId;

  // If no explicit target, use the currently engaged target (deny-by-default).
  // This is the “autofire intent” foundation: ranged can be invoked without args,
  // but only when you are already engaged with something in the room.
  let engaged: any | null = null;
  if (!targetName) {
    engaged = getEngagedTargetInRoom(ctx, selfEntity);

    // If the engaged target is a stealthed player, treat it as non-existent (no free tracking).
    if (engaged && isStealthedPlayerEntityForViewer(ctx, engaged)) {
      clearEngagedTarget(selfEntity);
      return "[combat] You cannot see that target.";
    }

    if (!engaged) {
      const hadId = String((selfEntity as any)?.engagedTargetId ?? "").trim();
      if (hadId) clearEngagedTarget(selfEntity);
      return "[combat] You are not engaged with a target.";
    }
  }

  // Resolve target.
  // v1: same-room only.
  const npcTarget = engaged
    ? (engaged.type === "npc" || engaged.type === "mob" ? engaged : null)
    : resolveTargetInRoom(ctx.entities as any, roomId, targetNameRaw, {
        selfId: selfEntity.id,
        filter: (e: any) => e?.type === "npc" || e?.type === "mob",
        radius: getRangedMaxRange(),
      });

  // Resolve player target (duel-gated PvP) if no NPC matched.
  const playerTarget: any =
    npcTarget
      ? null
      : engaged
        ? (engaged.type === "player" ? engaged : null)
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

  // Facing requirement (optional): forward cone. Default FOV is 360° so this
  // usually passes unless configured for "must face" gameplay.
  if (!canSeeTargetForwardCone(selfEntity, targetEntity, getRangedFovDeg())) {
    return `[combat] You must face ${targetEntity.name} to shoot.`;
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
      const scale = getRangedDamageScaleForCharacter(char);
      const roll = computeDamage(
        { char, effective, channel: "weapon" },
        { entity: npcTarget as any },
        { basePower: baseDmg, damageMultiplier: scale, damageSchool: "physical", rng: combatRng() },
      );
      const dmg = Math.max(1, roll.damage);

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

    const scale = getRangedDamageScaleForCharacter(char);

    return await performNpcAttack(ctx, char, selfEntity as any, npcTarget as any, {
      damageMultiplier: scale,
      // v1: ranged uses same damage model; later: weapon/ranged skill, ammo, falloff.
    });
  }

  // Players: duel-gated PvP with additional DamagePolicy backstop.
  if (playerTarget) {
    const gateRes = await gatePlayerDamageFromPlayerEntity(ctx, char, roomId, playerTarget);
    if (!gateRes.allowed) return gateRes.reason;

    // Stealth: deny targeting stealthed players.
    if (isStealthedForCombat(gateRes.targetChar as any)) {
      clearEngagedTarget(selfEntity);
      return "[combat] You cannot see that target.";
    }

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
    const scale = getRangedDamageScaleForCharacter(char);
    const roll = computeDamage(
      { char, effective, channel: "weapon" },
      { entity: playerTarget as any },
      { basePower: baseDmg, damageMultiplier: scale, damageSchool: "physical", rng: combatRng() },
    );
    const dmg = Math.max(1, roll.damage);

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

  // Taunting is a hostile commit: break stealth to avoid threat/assist leakage.
  const wasStealthed = isStealthedForCombat(char);
  if (wasStealthed) breakStealthForCombat(char);

  if (!ctx.npcs || typeof ctx.npcs.taunt !== "function") {
    return "Taunt is not available (NPC manager not wired).";
  }

  const durationMs = Math.max(500, Math.floor(envNumber("PW_TAUNT_DURATION_MS", 4000)));
  const threatBoost = Math.max(1, Math.floor(envNumber("PW_TAUNT_THREAT_BOOST", 10)));
  const ok = ctx.npcs.taunt(npcTarget.id, selfEntity.id, { durationMs, threatBoost });
  if (!ok) {
    return "[combat] That target cannot be taunted.";
  }

  return `[combat] You taunt ${npcTarget.name}.`;
}
