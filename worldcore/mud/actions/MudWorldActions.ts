// worldcore/mud/actions/MudWorldActions.ts

import type { MudContext } from "../MudContext";
import type { CharacterState } from "../../characters/CharacterTypes";
import { getNpcPrototype } from "../../npc/NpcTypes";
import { resolveTargetInRoom } from "../../targeting/TargetResolver";
import { applyProgressionForEvent } from "../MudProgressionHooks";
import {
  applyProgressionEvent,
  setNodeDepletedUntil,
} from "../../progression/ProgressionCore";
import { resolveItem } from "../../items/resolveItem";
import { describeLootLine, rollInt } from "../MudHelperFunctions";
import type { GatheringKind } from "../../progression/ProgressEvents";
import { Logger } from "../../utils/logger";
import { scheduleNpcCorpseAndRespawn } from "./MudCombatActions";

const log = Logger.scope("MUD");

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

  const selfEntity = entities.getEntityByOwner(ctx.session.id);
  if (!selfEntity) {
    return "You don't have a world entity yet.";
  }

  const roomId = selfEntity.roomId ?? char.shardId;

  const target = resolveTargetInRoom(entities, roomId, what, {
    selfId: selfEntity.id,
    filter: (e) => {
      if (e.type === "player") return false;
      if (e.type !== "node" && e.type !== "object") return false;
      if (typeof (e as any).spawnPointId !== "number") return false;

      // Per-player resource nodes (e.g. ore veins) honor ownership.
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

  if (!target) {
    return `There is no '${what}' here to gather.`;
  }

  if (typeof (target as any).spawnPointId !== "number") {
    return "That isn't a real resource node.";
  }

  const npcState = ctx.npcs.getNpcStateByEntityId(target.id);
  if (!npcState) {
    return "You can't gather that.";
  }

  const proto = getNpcPrototype(npcState.protoId);
  if (!proto || !proto.tags || !proto.tags.includes(resourceTag)) {
    return "That doesn't look gatherable.";
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
    return "You can't gather that.";
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
