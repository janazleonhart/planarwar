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

const RESOURCE_TAGS = new Set([
  "resource_ore",
  "resource_herb",
  "resource_wood",
  "resource_stone",
  "resource_fish",
  "resource_grain",
  "resource_mana",
]);

function asArray<T>(v: T | T[]): T[] {
  return Array.isArray(v) ? v : [v];
}

function expectedResourceTagFromProtoId(protoId: string): string | null {
  if (protoId.startsWith("ore_")) return "resource_ore";
  if (protoId.startsWith("herb_")) return "resource_herb";
  if (protoId.startsWith("wood_")) return "resource_wood";
  if (protoId.startsWith("stone_")) return "resource_stone";
  if (protoId.startsWith("fish_")) return "resource_fish";
  if (protoId.startsWith("grain_")) return "resource_grain";
  if (protoId.startsWith("mana_")) return "resource_mana";
  return null;
}

function suggestCommandForTag(tag: string): string {
  switch (tag) {
    case "resource_ore":
    case "resource_mana":
      return "mine";
    case "resource_herb":
      return "pick";
    case "resource_wood":
      return "log";
    case "resource_stone":
      return "quarry";
    case "resource_fish":
      return "fish";
    case "resource_grain":
      return "farm";
    default:
      return "gather";
  }
}

function gatherFlavor(nodeTag: string): string {
  switch (nodeTag) {
    case "resource_ore":
      return "You swing your pick into";
    case "resource_stone":
      return "You crack stone from";
    case "resource_wood":
      return "You chop into";
    case "resource_herb":
      return "You carefully harvest from";
    case "resource_fish":
      return "You cast a line into";
    case "resource_grain":
      return "You gather from";
    case "resource_mana":
      return "You siphon motes from";
    default:
      return "You work at";
  }
}

function respawnSecondsForNodeTag(nodeTag: string): number {
  // Tunable knobs. Node type should determine respawn, not the command used.
  switch (nodeTag) {
    case "resource_fish":
      return 75;
    case "resource_herb":
      return 90;
    case "resource_ore":
      return 120;
    case "resource_wood":
      return 120;
    case "resource_grain":
      return 120;
    case "resource_stone":
      return 140;
    case "resource_mana":
      return 150;
    default:
      return 120;
  }
}

/**
 * Fallback generic resource loot for nodes that don't yet have
 * explicit proto.loot definitions.
 *
 * IMPORTANT:
 * This is keyed off the *node type* (nodeTag), not the command used.
 * That prevents content mistakes from turning fish into ore loot.
 */
export function applyGenericResourceLoot(
  ctx: MudContext,
  char: CharacterState,
  _gatheringKind: GatheringKind,
  nodeTag: string,
  lootLines: string[]
): void {
  if (!ctx.items) return;

  let itemId: string | null = null;

  switch (nodeTag) {
    case "resource_ore":
      itemId = "ore_iron_hematite";
      break;
    case "resource_herb":
      itemId = "herb_peacebloom";
      break;
    case "resource_wood":
      itemId = "wood_oak";
      break;
    case "resource_stone":
      itemId = "stone_granite";
      break;
    case "resource_fish":
      itemId = "fish_river_trout";
      break;
    case "resource_grain":
      itemId = "grain_wheat";
      break;
    case "resource_mana":
      itemId = "mana_spark_arcane";
      break;
    default:
      return;
  }

  const tpl = resolveItem(ctx.items, itemId);
  if (!tpl) {
    log.warn("Generic resource loot template missing", { itemId, nodeTag });
    return;
  }

  const qty = rollInt(2, 5);
  if (qty <= 0) return;

  const res = ctx.items.addToInventory(char.inventory, tpl.id, qty);
  if (res.added > 0) lootLines.push(describeLootLine(tpl.id, res.added, tpl.name));
}

// ---------------------------------------------------------------------------
// Gathering / harvesting
// ---------------------------------------------------------------------------

export async function handleGatherAction(
  ctx: MudContext,
  char: CharacterState,
  targetNameRaw: string,
  gatheringKind: GatheringKind,
  allowedTags: string | string[]
): Promise<string> {
  const what = (targetNameRaw || "").trim() || "node";
  const allowed = asArray(allowedTags);

  if (!ctx.entities || !ctx.npcs) return "There is nothing here to gather.";

  const entities = ctx.entities;
  const npcs = ctx.npcs;

  const selfEntity = entities.getEntityByOwner(ctx.session.id);
  if (!selfEntity) return "You don't have a world entity yet.";

  const roomId = selfEntity.roomId ?? char.shardId;

  // Step 1: resolve ANY resource-like node/object by handle/name, not by tag.
  // We’ll enforce “right command for right resource type” after we find it.
  const target = resolveTargetInRoom(entities, roomId, what, {
    selfId: selfEntity.id,
    filter: (e) => {
      if (e.type === "player") return false;
      if (e.type !== "node" && e.type !== "object") return false;

      if (typeof (e as any).spawnPointId !== "number") return false;

      // Per-player resource nodes honor ownership.
      if ((e as any).ownerSessionId && (e as any).ownerSessionId !== ctx.session.id) {
        return false;
      }

      const st = npcs.getNpcStateByEntityId(e.id);
      if (!st) return false;

      const proto = getNpcPrototype(st.protoId);
      const tags = proto?.tags ?? [];

      // Resource-ish heuristic: has "resource" OR any resource subtype tag.
      if (tags.includes("resource")) return true;
      return tags.some((t) => RESOURCE_TAGS.has(t));
    },
  });

  if (!target) return `There is no '${what}' here to gather.`;

  const npcState = npcs.getNpcStateByEntityId(target.id);
  if (!npcState) return "You can't gather that.";

  const proto = getNpcPrototype(npcState.protoId);
  if (!proto) return "You can't gather that.";

  const tags = proto.tags ?? [];

  // Step 2: sanity-check resource subtype tags.
  const presentResourceTags = tags.filter((t) => RESOURCE_TAGS.has(t));
  if (presentResourceTags.length === 0) return "That doesn't look like a gatherable resource.";

  if (presentResourceTags.length > 1) {
    log.warn("Resource node has multiple resource subtype tags", {
      protoId: proto.id,
      presentResourceTags,
    });
    return "That resource node seems unstable (multiple resource types). Please tell an admin.";
  }

  const nodeTag = presentResourceTags[0];

  // Step 3: protoId naming convention guard (blocks mis-tagged DB rows).
  const expected = expectedResourceTagFromProtoId(proto.id);
  if (expected && expected !== nodeTag) {
    log.warn("Resource node tag mismatch vs protoId prefix", {
      protoId: proto.id,
      nodeTag,
      expected,
    });

    return `That node seems misconfigured. Try '${suggestCommandForTag(expected)}' (expected ${expected}).`;
  }

  // Step 4: enforce “right command for right resource type”.
  // IMPORTANT: this must occur before any damage is applied.
  if (!allowed.includes(nodeTag)) {
    return `That isn't compatible with '${suggestCommandForTag(allowed[0])}'. Try '${suggestCommandForTag(nodeTag)}'.`;
  }

  // ---- generic progression event ----
  applyProgressionEvent(char, {
    kind: "harvest",
    nodeProtoId: proto.id,
    gatheringKind,
    amount: 1,
  });

  // ---- MUD-side tasks/quests/titles ----
  const { snippets: progressionSnippets } = await applyProgressionForEvent(
    ctx,
    char,
    "harvests",
    proto.id
  );

  // Consume one “charge”
  const newHp = npcs.applyDamage(target.id, 1);
  if (newHp === null) return "You can't gather that.";

  const lootLines: string[] = [];

  if (!ctx.items) {
    log.warn("Gather loot skipped: ctx.items missing", {
      target: (target as any).name,
      protoId: proto.id,
    });
  } else if (proto.loot && proto.loot.length > 0) {
    for (const entry of proto.loot) {
      if (Math.random() > entry.chance) continue;

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
      if (res.added > 0) lootLines.push(describeLootLine(tpl.id, res.added, tpl.name));
    }
  } else {
    // Fallback: keyed off node type, not the command.
    applyGenericResourceLoot(ctx, char, gatheringKind, nodeTag, lootLines);
  }

  // Persist inventory + progression changes
  ctx.session.character = char;
  if (ctx.characters) {
    try {
      await ctx.characters.saveCharacter(char);
    } catch (err) {
      log.warn("Failed to save character after gather", { err, charId: char.id });
    }
  }

  const name = (target as any).name;
  let line = `[harvest] ${gatherFlavor(nodeTag)} ${name}.`;
  if (lootLines.length > 0) line += ` You gather ${lootLines.join(", ")}.`;

  if (newHp <= 0) {
    line += ` The ${name} is exhausted.`;

    const respawnSeconds = respawnSecondsForNodeTag(nodeTag);

    // Personal resource node depletion uses spawnPointId timers.
    if (target.type === "node" && typeof (target as any).spawnPointId === "number") {
      setNodeDepletedUntil(char, (target as any).spawnPointId, Date.now() + respawnSeconds * 1000);

      if (ctx.characters) {
        try {
          await ctx.characters.saveCharacter(char);
        } catch (err) {
          log.warn("Failed to save character after node depletion", { err, charId: char.id });
        }
      }

      // Fix D: tell visual clients to remove it immediately.
      try {
        ctx.sessions.send(ctx.session, "entity_despawn" as any, {
          id: target.id,
          ownerSessionId: ctx.session.id,
        });
      } catch {
        // best-effort
      }

      ctx.npcs?.despawnNpc?.(target.id);
    } else {
      // Shared NPC behavior (mobs etc.)
      scheduleNpcCorpseAndRespawn(ctx, target.id);
    }
  }

  if (progressionSnippets.length > 0) line += " " + progressionSnippets.join(" ");

  return line;
}

// Skinning: starter fallback loot.
// Later: replace with DB-driven creature-family loot.
// Skinning: starter fallback loot.
// Later: prefer DB-driven skin_loot profiles (see SkinLootService) and keep this as a safety net.
export function applyFallbackSkinLoot(protoId: string): { itemId: string; minQty: number; maxQty: number } | null {
  const proto = getNpcPrototype(protoId);
  const tags = proto?.tags ?? [];
  const isSkinnable = Array.isArray(tags) && (tags.includes("beast") || tags.includes("critter"));
  if (!isSkinnable) return null;
  return { itemId: "hide_scraps", minQty: 1, maxQty: 2 };
}

