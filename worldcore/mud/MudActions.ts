// worldcore/mud/MudActions.ts

import { MudContext } from "./MudContext";
import { CharacterState } from "../characters/CharacterTypes";
import { Entity } from "../shared/Entity";

import { computeEffectiveAttributes } from "../characters/Stats";
import { Logger } from "../utils/logger";
import { getNpcPrototype } from "../npc/NpcTypes";

import {
  markInCombat,
  findNpcTargetByName,
  findTargetPlayerEntityByName,
  describeLootLine,
  rollInt,
} from "./MudHelperFunctions";

import {
  getTrainingDummyForRoom,
  computeTrainingDummyDamage,
  startTrainingDummyAi,
} from "./MudTrainingDummy";

import { resolveItem } from "../items/resolveItem";

import { applyProgressionForEvent } from "./MudProgressionHooks";
import { applyProgressionEvent, setNodeDepletedUntil } from "../progression/ProgressionCore";
import { resolveTargetInRoom } from "../targeting/TargetResolver";

import type { GatheringKind } from "../progression/ProgressEvents";

import {
  performNpcAttack as performNpcAttackCore,
  scheduleNpcCorpseAndRespawn as scheduleNpcCorpseAndRespawnCore,
  announceSpawnToRoom as announceSpawnToRoomCore,
  type NpcAttackOptions,
} from "../combat/NpcCombat";

const log = Logger.scope("MUD");

export type { NpcAttackOptions } from "../combat/NpcCombat";

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

// ---------------------------------------------------------------------------
// Gathering / harvesting
// ---------------------------------------------------------------------------

export async function handleGatherAction(
  ctx: MudContext,
  char: CharacterState,
  targetNameRaw: string,
  gatheringKind: GatheringKind,
  resourceTag: string, // e.g. "resource_ore", "resource_herb"
): Promise<string> {
  const what = (targetNameRaw || "").trim() || "ore";

  if (!ctx.entities || !ctx.npcs) {
    return "There is nothing here to gather.";
  }

  const npcs = ctx.npcs;
  const entities = ctx.entities;

  const selfEntity = ctx.entities.getEntityByOwner(ctx.session.id);
  if (!selfEntity) {
    return "You don’t have a world entity yet.";
  }

  const roomId = selfEntity.roomId ?? char.shardId;

  const target = resolveTargetInRoom(entities, roomId, what, {
    selfId: selfEntity.id,
    filter: (e) => {
      if (e.type === "player") return false;
      if (e.type !== "node" && e.type !== "object") return false;

      if (typeof (e as any).spawnPointId !== "number") return false;

      if (
        (e as any).ownerSessionId &&
        (e as any).ownerSessionId !== ctx.session.id
      ) {
        return false;
      }

      const st = npcs.getNpcStateByEntityId(e.id);
      if (!st) return false;

      const proto = getNpcPrototype(st.protoId);
      return (proto?.tags ?? []).includes(resourceTag);
    },
  });

  if (!target) return `There is no '${what}' here to gather.`;

  if (typeof (target as any).spawnPointId !== "number") {
    return "That isn't a real resource node.";
  }

  const npcState = ctx.npcs.getNpcStateByEntityId(target.id);
  if (!npcState) {
    return "You can’t gather that.";
  }

  const proto = getNpcPrototype(npcState.protoId);
  if (!proto || !proto.tags || !proto.tags.includes(resourceTag)) {
    return "That doesn’t look gatherable.";
  }

  // ---- NEW: generic progression event ----
  applyProgressionEvent(char, {
    kind: "harvest",
    nodeProtoId: proto.id,
    gatheringKind,
    amount: 1,
  });

  // ---- EXISTING: MUD-side tasks/quests/titles ----
  const { snippets: progressionSnippets } = await applyProgressionForEvent(
    ctx,
    char,
    "harvests",
    proto.id,
  );

  // Chip away one HP/charge
  const newHp = ctx.npcs.applyDamage(target.id, 1);
  if (newHp === null) {
    return "You can’t gather that.";
  }

  const lootLines: string[] = [];

  if (!ctx.items) {
    log.warn("Gather loot skipped: ctx.items missing", {
      target: target.name,
      protoId: proto.id,
    });
  } else if (proto.loot && proto.loot.length > 0) {
    for (const entry of proto.loot) {
      const r = Math.random();
      if (r > entry.chance) continue;

      const qty = rollInt(entry.minQty, entry.maxQty);
      if (qty <= 0) continue;

      const tpl = resolveItem(ctx.items, entry.itemId);
      if (!tpl) {
        log.warn("Gather loot template missing", {
          itemId: entry.itemId,
          protoId: proto.id,
        });
        continue;
      }

      const res = ctx.items.addToInventory(char.inventory, tpl.id, qty);
      if (res.added > 0) {
        lootLines.push(describeLootLine(tpl.id, res.added, tpl.name));
      }
    }
  }

  // Persist inventory + progression changes
  ctx.session.character = char;
  if (ctx.characters) {
    try {
      await ctx.characters.saveCharacter(char);
    } catch (err) {
      log.warn("Failed to save character after gather", {
        err,
        charId: char.id,
      });
    }
  }

  let line = `[harvest] You chip away at ${target.name}.`;
  if (lootLines.length > 0) {
    line += ` You gather ${lootLines.join(", ")}.`;
  }

  if (newHp <= 0) {
    line += ` The ${target.name} is exhausted.`;

    if (target.type === "node" && typeof target.spawnPointId === "number") {
      const respawnSeconds =
        gatheringKind === "mining"
          ? 120
          : gatheringKind === "herbalism"
          ? 90
          : 120;

      setNodeDepletedUntil(
        char,
        target.spawnPointId,
        Date.now() + respawnSeconds * 1000,
      );

      if (ctx.characters) {
        try {
          await ctx.characters.saveCharacter(char);
        } catch (err) {
          log.warn("Failed to save character after node depletion", {
            err,
            charId: char.id,
          });
        }
      }

      ctx.npcs?.despawnNpc?.(target.id);
    } else {
      // Shared NPC behavior (mobs etc.)
      scheduleNpcCorpseAndRespawn(ctx, target.id);
    }
  }

  if (progressionSnippets.length > 0) {
    line += " " + progressionSnippets.join(" ");
  }

  return line;
}
