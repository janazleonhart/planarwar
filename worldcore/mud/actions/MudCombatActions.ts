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

import { computeEffectiveAttributes } from "../../characters/Stats";

import {
  findNpcTargetByName,
  findTargetPlayerEntityByName,
  markInCombat,
} from "../MudHelperFunctions";

import {
  getTrainingDummyForRoom,
  computeTrainingDummyDamage,
  startTrainingDummyAi,
} from "../MudTrainingDummy";

import { applyProgressionForEvent } from "../MudProgressionHooks";
import { applyProgressionEvent } from "../../progression/ProgressionCore";

import { applySimpleDamageToPlayer } from "../../combat/entityCombat";
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
 */
export async function performNpcAttack(
  ctx: MudContext,
  char: CharacterState,
  selfEntity: Entity,
  npc: Entity,
  opts?: NpcAttackOptions,
): Promise<string> {
  return performNpcAttackCore(ctx, char, selfEntity, npc, opts ?? {});
}

// Re-exported wrappers for backwards compatibility (MudActions imports these).
export function scheduleNpcCorpseAndRespawn(ctx: MudContext, entityId: string): void {
  return scheduleNpcCorpseAndRespawnCore(ctx, entityId);
}

export function announceSpawnToRoom(ctx: MudContext, roomId: string, text: string): void {
  return announceSpawnToRoomCore(ctx, roomId, text);
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
  if (!targetName) return "Usage: attack <target>";

  if (!ctx.entities) return "Combat is not available here (no entity manager).";

  const selfEntity = ctx.entities.getEntityByOwner(ctx.session.id);
  if (!selfEntity) return "You have no body here.";

  const world = ctx.world;
  if (!world) return "The world is not initialized yet.";

  const roomId = selfEntity.roomId ?? char.shardId;

  // 1) Try NPC target first (rats, ore, dummies, etc.)
  const npcTarget = findNpcTargetByName(ctx.entities, roomId, targetNameRaw);
  if (npcTarget) {
    const npcState = ctx.npcs?.getNpcStateByEntityId(npcTarget.id);
    const protoId = npcState?.protoId;

    // Training dummy: use the non-lethal dummy HP pool and NEVER route through NpcCombat
    // (so the dummy doesn't fight back via NPC AI).
    if (protoId === "training_dummy_big") {
      const dummyInstance = getTrainingDummyForRoom(roomId);

      markInCombat(selfEntity);
      markInCombat(dummyInstance as any);
      startTrainingDummyAi(ctx, ctx.session.id, roomId);

      const effective = computeEffectiveAttributes(char, ctx.items);
      const dmg = computeTrainingDummyDamage(effective);

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

    // Normal NPC attack flow
    let result = await performNpcAttack(ctx, char, selfEntity, npcTarget);

    // If this line indicates a kill, emit the event then let the hook react.
    if (result.includes("You slay")) {
      const protoIdForProgress =
        ctx.npcs?.getNpcStateByEntityId(npcTarget.id)?.protoId ?? npcTarget.name;

      // 1) record the kill in progression
      applyProgressionEvent(char, {
        kind: "kill",
        targetProtoId: protoIdForProgress,
      });

      // 2) react: tasks, quests, titles, xp, DB patch
      // Signature: (ctx, char, category, targetProtoId)
      const { snippets } = await applyProgressionForEvent(
        ctx,
        char,
        "kills",
        protoIdForProgress,
      );
      if (snippets.length > 0) {
        result += " " + snippets.join(" ");
      }

      // 3) schedule corpse + respawn
      scheduleNpcCorpseAndRespawn(ctx, npcTarget.id);
    }

    return result;
  }

  // 2) Try another player – duel-gated PvP (open PvP zones can come later).
  const playerTarget = findTargetPlayerEntityByName(ctx, roomId, targetNameRaw);
  if (playerTarget) {
    const gateRes = await gatePlayerDamageFromPlayerEntity(ctx, char, roomId, playerTarget);
    if (!gateRes.allowed) {
      return gateRes.reason;
    }

    const { now, label, mode: ctxMode, targetChar, targetSession } = gateRes;

    const effective = computeEffectiveAttributes(char, ctx.items);
    const dmg = computeTrainingDummyDamage(effective);

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
      return `[${label}] You hit ${playerTarget.name} for ${dmg} damage. You defeat them. (0/${maxHp} HP)`;
    }

    return `[${label}] You hit ${playerTarget.name} for ${dmg} damage. (${newHp}/${maxHp} HP)`;
  }

  // 3) Fallback: name-only training dummy (if no NPC entity was matched)
  if (targetName.toLowerCase().includes("dummy")) {
    const dummyInstance = getTrainingDummyForRoom(roomId);

    markInCombat(selfEntity);
    markInCombat(dummyInstance as any);
    startTrainingDummyAi(ctx, ctx.session.id, roomId);

    const effective = computeEffectiveAttributes(char, ctx.items);
    const dmg = computeTrainingDummyDamage(effective);

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
  return `There is no '${targetNameRaw}' here to attack.`;
}
