// worldcore/quests/QuestText.ts

import { ensureProgression } from "../progression/ProgressionCore";
import { ensureQuestState } from "./QuestState";
import { getAllQuests } from "./QuestRegistry";
import { countItemInInventory } from "../items/inventoryConsume";

import type { QuestObjective } from "./QuestTypes";
import type { CharacterState } from "../characters/CharacterTypes";

export function renderQuestLog(char: CharacterState): string {
  const prog = ensureProgression(char);
  const kills = (prog.kills as Record<string, number>) || {};
  const harvests = (prog.harvests as Record<string, number>) || {};
  const actions = (prog.actions as Record<string, number>) || {};
  const flags = (prog.flags as Record<string, unknown>) || {};  // ← NEW
  const state = ensureQuestState(char);

  let out = "Quests:\n";

  for (const q of getAllQuests()) {
    const entry = state[q.id] || { state: "active" as const };

    const mark =
      entry.state === "completed"
        ? "[C]"
        : entry.state === "turned_in"
        ? "[T]"
        : "[ ]";

    let repeatInfo = "";
    if (q.repeatable) {
      const completions = entry.completions ?? 0;
      const max = q.maxCompletions ?? null;

      if (max != null) {
        repeatInfo = ` [repeatable ${completions}/${max}]`;
      } else {
        repeatInfo = ` [repeatable ${completions}/∞]`;
      }
    }

    out += ` ${mark} ${q.name} (${q.id})${repeatInfo}\n`;

    for (const obj of q.objectives) {
      out += renderObjectiveLine(char, obj, { kills, harvests, actions, flags }); // ← flags added
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
      const talked = Boolean(flags[key]);
      const current = talked ? 1 : 0;
      const display = Math.min(current, required);
      return `   - Talk to ${obj.npcId} (${display}/${required})\n`;
    }

    default:
      return "";
  }
}
