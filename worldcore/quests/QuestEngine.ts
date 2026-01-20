// worldcore/quests/QuestEngine.ts
//
// IMPORTANT CHANGE (Quest Board v0):
// - We no longer auto-activate every quest in the registry.
// - We ONLY evaluate quests that the character has accepted (present in QuestStateMap).

import { ensureProgression } from "../progression/ProgressionCore";
import { ensureQuestState } from "./QuestState";
import { countItemInInventory } from "../items/inventoryConsume";
import { resolveQuestDefinitionFromStateId } from "./TownQuestBoard";

import type { CharacterState } from "../characters/CharacterTypes";
import type { QuestDefinition, QuestObjective } from "./QuestTypes";

/**
 * Evaluate accepted quests against the character's current progression + inventory.
 * Any quest that was active and now fully satisfied is marked "completed"
 * and returned in the result.
 */
export function updateQuestsFromProgress(
  char: CharacterState
): { completed: QuestDefinition[] } {
  const prog = ensureProgression(char);

  const kills = (prog.kills as Record<string, number>) || {};
  const harvests = (prog.harvests as Record<string, number>) || {};
  const actions = (prog.actions as Record<string, number>) || {};
  const flags = (prog.flags as Record<string, unknown>) || {};

  const state = ensureQuestState(char);
  const completed: QuestDefinition[] = [];

  for (const [questId, entry] of Object.entries(state)) {
    if (!entry || entry.state !== "active") continue;

    const q = resolveQuestDefinitionFromStateId(questId, entry);
    if (!q) continue;

    let allDone = true;

    for (const obj of q.objectives) {
      if (!isObjectiveSatisfied(obj, { char, kills, harvests, actions, flags })) {
        allDone = false;
        break;
      }
    }

    if (allDone) {
      entry.state = "completed";
      completed.push(q);
    }
  }

  return { completed };
}

function isObjectiveSatisfied(
  obj: QuestObjective,
  ctx: {
    char: CharacterState;
    kills: Record<string, number>;
    harvests: Record<string, number>;
    actions: Record<string, number>;
    flags: Record<string, unknown>;
  }
): boolean {
  const { char, kills, harvests, actions, flags } = ctx;

  switch (obj.kind) {
    case "kill": {
      const cur = kills[obj.targetProtoId] ?? 0;
      return cur >= obj.required;
    }

    case "harvest": {
      const cur = harvests[obj.nodeProtoId] ?? 0;
      return cur >= obj.required;
    }

    case "collect_item": {
      const inv = char.inventory;
      const have = countItemInInventory(inv, obj.itemId);
      return have >= obj.required;
    }

    case "craft": {
      const cur = actions[obj.actionId] ?? 0;
      return cur >= obj.required;
    }

    case "city": {
      const cur = actions[obj.cityActionId] ?? 0;
      return cur >= obj.required;
    }

    case "talk_to": {
      const required = obj.required ?? 1;
      const key = `talked_to:${obj.npcId}`;
      const v = flags[key];
      const cur = typeof v === "number" ? v : v ? 1 : 0;
      return cur >= required;
    }

    default:
      return false;
  }
}
