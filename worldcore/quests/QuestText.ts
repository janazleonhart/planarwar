// worldcore/quests/QuestText.ts
//
// IMPORTANT CHANGE (Quest Board v0):
// - Quest log now renders ONLY accepted quests (present in QuestStateMap).
// - No more "missing entry means active" behavior.

import { ensureProgression } from "../progression/ProgressionCore";
import { ensureQuestState } from "./QuestState";
import { countItemInInventory } from "../items/inventoryConsume";
import { resolveQuestDefinitionFromStateId } from "./TownQuestBoard";

import type { QuestObjective } from "./QuestTypes";
import type { CharacterState } from "../characters/CharacterTypes";

export function renderQuestLog(char: CharacterState): string {
  const prog = ensureProgression(char);
  const kills = (prog.kills as Record<string, number>) || {};
  const harvests = (prog.harvests as Record<string, number>) || {};
  const actions = (prog.actions as Record<string, number>) || {};
  const flags = (prog.flags as Record<string, unknown>) || {};

  const state = ensureQuestState(char);
  const ids = Object.keys(state);

  if (ids.length === 0) {
    return "Quests:\n - None accepted.\n\nUse: quest board\n      quest accept <#|id>";
  }

  let out = "Quests:\n";

  for (const id of ids.sort()) {
    const entry = state[id];
    if (!entry) continue;

    const q = resolveQuestDefinitionFromStateId(id, entry);

    const name = q?.name ?? id;
    const mark =
      entry.state === "completed"
        ? "[C]"
        : entry.state === "turned_in"
        ? "[T]"
        : "[A]";

    let repeatInfo = "";
    if (q?.repeatable) {
      const completions = entry.completions ?? 0;
      const max = q.maxCompletions ?? null;

      if (max != null) repeatInfo = ` [repeatable ${completions}/${max}]`;
      else repeatInfo = ` [repeatable ${completions}/∞]`;
    }

    out += ` ${mark} ${name} (${id})${repeatInfo}\n`;

    if (q) {
      for (const obj of q.objectives) {
        out += renderObjectiveLine(char, obj, { kills, harvests, actions, flags });
      }
    } else {
      out += "   - (Quest definition missing; cannot render objectives.)\n";
    }
  }

  return out.trimEnd();
}

type ObjectiveRenderCtx = {
  kills: Record<string, number>;
  harvests: Record<string, number>;
  actions: Record<string, number>;
  flags: Record<string, unknown>;
};

function renderObjectiveLine(
  char: CharacterState,
  obj: QuestObjective,
  ctx: ObjectiveRenderCtx
): string {
  const { kills, harvests, actions, flags } = ctx;

  switch (obj.kind) {
    case "kill": {
      const raw = kills[obj.targetProtoId] ?? 0;
      const display = Math.min(raw, obj.required);
      return `   - Kill ${obj.required}x ${obj.targetProtoId} (${display}/${obj.required})\n`;
    }

    case "harvest": {
      const raw = harvests[obj.nodeProtoId] ?? 0;
      const display = Math.min(raw, obj.required);
      return `   - Harvest ${obj.required}x ${obj.nodeProtoId} (${display}/${obj.required})\n`;
    }

    case "collect_item": {
      const inv = char.inventory;
      const raw = countItemInInventory(inv, obj.itemId);
      const display = Math.min(raw, obj.required);
      return `   - Bring ${obj.required}x ${obj.itemId} (${display}/${obj.required})\n`;
    }

    case "craft": {
      const raw = actions[obj.actionId] ?? 0;
      const display = Math.min(raw, obj.required);
      return `   - Craft ${obj.required}x ${obj.actionId} (${display}/${obj.required})\n`;
    }

    case "city": {
      const raw = actions[obj.cityActionId] ?? 0;
      const display = Math.min(raw, obj.required);
      return `   - Complete ${obj.required}x ${obj.cityActionId} (${display}/${obj.required})\n`;
    }

    case "talk_to": {
      const required = obj.required ?? 1;
      const key = `talked_to:${obj.npcId}`;
      const v = flags[key];
      const cur = typeof v === "number" ? v : v ? 1 : 0;
      const display = Math.min(cur, required);
      return `   - Talk to ${obj.npcId} (${display}/${required})\n`;
    }

    default:
      return "";
  }
}
