// worldcore/mud/actions/MudCombatActions.ts

import type { MudContext } from "../MudContext";
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

// Re-exported wrappers for backwards compatibility
export function scheduleNpcCorpseAndRespawn(
  ctx: MudContext,
  npcEntityId: string,
): void {
  return scheduleNpcCorpseAndRespawnCore(ctx, npcEntityId);
}

export function announceSpawnToRoom(
  ctx: MudContext,
  roomId: string,
  text: string,
): void {
  return announceSpawnToRoomCore(ctx, roomId, text);
}

// ---------------------------------------------------------------------------
// Shared attack handler used by both MUD and future action pipeline.
// ---------------------------------------------------------------------------

export async function handleAttackAction(
  ctx: MudContext,
  char: CharacterState,
  targetNameRaw: string,
): Promise<string> {
  const targetName = targetNameRaw.toLowerCase().trim();
  if (!targetName) {
    return "Usage: attack <target>";
  }

  if (!ctx.entities) {
    return "Combat is not available here (no entity manager).";
  }

  const selfEntity = ctx.entities.getEntityByOwner(ctx.session.id);
  if (!selfEntity) {
    return "You have no body here.";
  }

  const world = ctx.world;
  if (!world) {
    return "The world is not initialized yet.";
  }

  const roomId = selfEntity.roomId ?? char.shardId;

  // 1) Try NPC target first (rats, ore, etc.)
  const npcTarget = findNpcTargetByName(ctx.entities, roomId, targetNameRaw);
  if (npcTarget) {
    let result = await performNpcAttack(ctx, char, selfEntity, npcTarget);

    // If this line indicates a kill, emit the event then let the hook react.
    if (result.includes("You slay")) {
      const protoId =
        ctx.npcs?.getNpcStateByEntityId(npcTarget.id)?.protoId ??
        npcTarget.name;

      // 1) record the kill in progression
      applyProgressionEvent(char, {
        kind: "kill",
        targetProtoId: protoId,
      });

      // 2) react: tasks, quests, titles, xp, DB patch
      const { snippets } = await applyProgressionForEvent(
        ctx,
        char,
        "kills",
        protoId,
      );

      if (snippets.length > 0) {
        result += " " + snippets.join(" ");
      }
    }

    return result;
  }

  // 2) Try another player – but enforce "no PvP here" rule (for now).
  const playerTarget = findTargetPlayerEntityByName(
    ctx,
    roomId,
    targetNameRaw,
  );

  if (playerTarget) {
    return "You can't attack other players here (PvP zones will come later).";
  }

  // 3) Training dummy logic
  const dummy = getTrainingDummyForRoom(roomId);
  if (!dummy) {
    return "[combat] There is nothing here to train on.";
  }

  if (targetName.includes("dummy")) {
    const dummyInstance = getTrainingDummyForRoom(roomId);
    if (!dummyInstance) {
      return "[combat] There is nothing here to train on.";
    }

    // Tag both sides as "in combat"
    markInCombat(selfEntity);
    markInCombat(dummyInstance);

    // Start dummy AI for this player
    startTrainingDummyAi(ctx, ctx.session.id, roomId);

    const effective = computeEffectiveAttributes(char, ctx.items);
    const dmg = computeTrainingDummyDamage(effective);

    dummyInstance.hp = Math.max(0, dummyInstance.hp - dmg);

    let line: string;

    if (dummyInstance.hp > 0) {
      line =
        `[combat] You hit the Training Dummy for ${dmg} damage. ` +
        `(${dummyInstance.hp}/${dummyInstance.maxHp} HP)`;
    } else {
      line =
        `[combat] You obliterate the Training Dummy for ${dmg} damage! ` +
        `(0/${dummyInstance.maxHp} HP – it quickly knits itself back together.)`;
      dummyInstance.hp = dummyInstance.maxHp;
    }

    return line;
  }

  // 4) No valid target.
  return `There is no '${targetNameRaw}' here to attack.`;
}
