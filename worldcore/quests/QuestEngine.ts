// worldcore/quests/QuestEngine.ts
//
// Quest evaluation engine.
// - Evaluates ONLY accepted quests (those present in the quest state map).
// - Supports BOTH registry quests and deterministic generated quests (town board).
//
// Rationale:
// Earlier versions iterated over *all* registry quests, which:
//   1) accidentally “auto-accepted” everything by creating active entries, and
//   2) could never complete generated town quests because they are not in QuestRegistry.
//
// This file is intentionally side-effecty: it mutates quest state entries from
// "active" -> "completed" when objectives are satisfied.

import type { CharacterState } from "../characters/CharacterTypes";
import type { QuestDefinition, QuestObjective } from "./QuestTypes";

import { ensureProgression } from "../progression/ProgressionCore";
import { ensureQuestState } from "./QuestState";
import { countItemInInventory } from "../items/inventoryConsume";

import { resolveQuestDefinitionFromStateId as resolveQuestDefFromState } from "./TownQuestBoard";

type ObjectiveEvalCtx = {
  char: CharacterState;
  kills: Record<string, number>;
  harvests: Record<string, number>;
  actions: Record<string, number>;
  flags: Record<string, any>;
};

/**
 * Evaluate the character's accepted quests against current progression + inventory.
 * Any quest that was active and now fully satisfied is marked "completed".
 *
 * Returns the list of QuestDefinitions that flipped to completed in this call.
 */
export function updateQuestsFromProgress(
  char: CharacterState,
): { completed: QuestDefinition[] } {
  const prog = ensureProgression(char);

  const kills = (prog.kills as Record<string, number>) ?? {};
  const harvests = (prog.harvests as Record<string, number>) ?? {};
  const actions = (prog.actions as Record<string, number>) ?? {};
  const flags = (prog.flags as Record<string, any>) ?? {};

  const state = ensureQuestState(char) as Record<string, any>;
  const completed: QuestDefinition[] = [];

  const ctx: ObjectiveEvalCtx = { char, kills, harvests, actions, flags };

  // Only evaluate quests the player has actually accepted (present in state map).
  for (const [questId, entry] of Object.entries(state)) {
    if (!entry || entry.state !== "active") continue;

    const q = resolveQuestDefFromState(questId, entry);
    if (!q) {
      // Stale/unknown quest id in state map; skip silently.
      continue;
    }

    let allDone = true;
    for (const obj of q.objectives) {
      if (!isObjectiveSatisfied(obj, ctx)) {
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

/**
 * Compatibility wrapper.
 * Some callers import this symbol from QuestEngine rather than TownQuestBoard.
 */
export function resolveQuestDefinitionFromStateId(
  questId: string,
  entry?: unknown,
): QuestDefinition | null {
  return resolveQuestDefFromState(questId, entry as any);
}

// ---------------------------------------------------------------------------
// Objective evaluation
// ---------------------------------------------------------------------------

function isObjectiveSatisfied(obj: QuestObjective, ctx: ObjectiveEvalCtx): boolean {
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
      const have = countItemInInventory(char.inventory, obj.itemId);
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

      // Talk system currently stores boolean, but support numeric later.
      const cur = typeof v === "number" ? v : v ? 1 : 0;
      return cur >= required;
    }

    default:
      // Future objective kinds (go_to, interact, etc.) can be wired here.
      return false;
  }
}
