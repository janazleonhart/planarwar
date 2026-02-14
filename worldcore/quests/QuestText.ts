// worldcore/quests/QuestText.ts
//
// IMPORTANT CHANGE (Quest Board v0):
// - Quest log now renders ONLY accepted quests (present in QuestStateMap).
// - No more "missing entry means active" behavior.

import { ensureProgression } from "../progression/ProgressionCore";
import { ensureQuestState } from "./QuestState";
import { countItemInInventory } from "../items/inventoryConsume";
import { resolveQuestDefinitionFromStateId } from "./TownQuestBoard";
import { getAllQuests, getQuestById } from "./QuestRegistry";

import type { QuestDefinition, QuestObjective } from "./QuestTypes";
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
    const isCompleted = entry.state === "completed";
    const isTurnedIn = entry.state === "turned_in";
    const isReady = !!(
      q &&
      isCompleted &&
      areObjectivesSatisfied(q, char, { kills, harvests, actions, flags })
    );

    const mark = isTurnedIn ? "[T]" : isReady ? "[READY]" : isCompleted ? "[C]" : "[A]";

    let repeatInfo = "";
    if (q?.repeatable) {
      const completions = entry.completions ?? 0;
      const max = q.maxCompletions ?? null;

      if (max != null) repeatInfo = ` [repeatable ${completions}/${max}]`;
      else repeatInfo = ` [repeatable ${completions}/∞]`;
    }

    out += ` ${mark} ${name} (${id})${repeatInfo}\n`;

    if (q) {
      if (isReady) {
        const rewardText = renderQuestRewardSummary(q);
        if (rewardText) out += `   Rewards: ${rewardText}\n`;
      }
      for (const obj of q.objectives) {
        out += renderObjectiveLine(char, obj, { kills, harvests, actions, flags });
      }
    } else {
      out += "   - (Quest definition missing; cannot render objectives.)\n";
    }
  }

  return out.trimEnd();
}

/**
 * Quest details view used by `quest show <#|id|name>`.
 * - Works for accepted quests (including deterministic town quests)
 * - Also works for registry quests not yet accepted
 */
export function renderQuestDetails(char: CharacterState, targetRaw: string): string {
  const target = (targetRaw || "").trim();
  if (!target) {
    return [
      "Usage:",
      " quest show <#|id|name>",
      "",
      "Tip: Use `quest` to list accepted quests.",
    ].join("\n");
  }

  const prog = ensureProgression(char);
  const kills = (prog.kills as Record<string, number>) || {};
  const harvests = (prog.harvests as Record<string, number>) || {};
  const actions = (prog.actions as Record<string, number>) || {};
  const flags = (prog.flags as Record<string, unknown>) || {};

  const questState = ensureQuestState(char);
  const acceptedIds = Object.keys(questState).sort();

  // Numeric index into accepted quest ordering
  let key = target;
  if (/^\d+$/.test(target)) {
    const idx = Number(target);
    const id = acceptedIds[idx - 1];
    if (id) key = id;
  }

  const resolved = resolveQuestByIdOrNameIncludingAccepted(key, questState);
  if (!resolved) {
    return `[quest] Unknown quest '${target}'.`;
  }

  const quest = resolved.quest;
  const entry = questState[quest.id] ?? null;

  const isAccepted = !!entry;
  const state = isAccepted ? String(entry.state ?? "active") : "not_accepted";

  const isCompleted = state === "completed";
  const isTurnedIn = state === "turned_in";

  const isReady = !!(
    isCompleted && areObjectivesSatisfied(quest, char, { kills, harvests, actions, flags })
  );

  const mark = isTurnedIn ? "[T]" : isReady ? "[READY]" : isCompleted ? "[C]" : isAccepted ? "[A]" : "[ ]";

  const lines: string[] = [];
  lines.push(`[quest] ${mark} ${quest.name} (${quest.id})`);
  lines.push(`State: ${state}${isReady ? " (ready)" : ""}`);

  if (quest.description) {
    lines.push("");
    lines.push(quest.description);
  }

  lines.push("");
  lines.push("Objectives:");
  for (const obj of quest.objectives ?? []) {
    lines.push(renderObjectiveLine(char, obj, { kills, harvests, actions, flags }).trimEnd());
  }

  const rewardText = renderQuestRewardSummary(quest);
  if (rewardText) {
    lines.push("");
    lines.push(`Rewards: ${rewardText}`);
  }

  if (isReady) {
    lines.push("");
    lines.push(`Turn in with: quest turnin ${quest.id}`);
  }

  return lines.join("\n").trimEnd();
}

type ObjectiveRenderCtx = {
  kills: Record<string, number>;
  harvests: Record<string, number>;
  actions: Record<string, number>;
  flags: Record<string, unknown>;
  // Provided by areObjectivesSatisfied() for collect_item checks.
  // renderObjectiveLine() does not require it.
  inv?: CharacterState["inventory"];
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

function areObjectivesSatisfied(
  quest: { objectives: QuestObjective[] },
  char: CharacterState,
  ctx: Omit<ObjectiveRenderCtx, "inv">,
): boolean {
  const inv = char.inventory;
  for (const obj of quest.objectives ?? []) {
    if (!isObjectiveSatisfied(obj, { ...ctx, inv })) return false;
  }
  return true;
}

function isObjectiveSatisfied(
  obj: QuestObjective,
  ctx: ObjectiveRenderCtx,
): boolean {
  const { kills, harvests, actions, flags, inv } = ctx;

  switch (obj.kind) {
    case "kill":
      return (kills[obj.targetProtoId] ?? 0) >= obj.required;
    case "harvest":
      return (harvests[obj.nodeProtoId] ?? 0) >= obj.required;
    case "collect_item":
      return !!inv && countItemInInventory(inv, obj.itemId) >= obj.required;
    case "craft":
      return (actions[obj.actionId] ?? 0) >= obj.required;
    case "city":
      return (actions[obj.cityActionId] ?? 0) >= obj.required;
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

function resolveQuestByIdOrNameIncludingAccepted(
  input: string,
  questState: Record<string, any>
): { quest: QuestDefinition } | null {
  const lower = input.toLowerCase();

  // 1) Exact id in registry
  const byId = getQuestById(input);
  if (byId) return { quest: byId };

  // 2) Exact id match in accepted state (generated or registry)
  if (questState[input]) {
    const q = resolveQuestDefinitionFromStateId(input, questState[input]);
    if (q) return { quest: q };
  }

  // 3) Case-insensitive by id or name in registry
  const all = getAllQuests();
  const idMatch = all.find((q) => q.id.toLowerCase() === lower);
  if (idMatch) return { quest: idMatch };
  const nameMatch = all.find((q) => q.name.toLowerCase() === lower);
  if (nameMatch) return { quest: nameMatch };

  // 4) Case-insensitive match among accepted quests (generated)
  for (const [id, entry] of Object.entries(questState)) {
    const q = resolveQuestDefinitionFromStateId(id, entry);
    if (!q) continue;
    if (q.id.toLowerCase() === lower) return { quest: q };
    if (q.name.toLowerCase() === lower) return { quest: q };
  }

  return null;
}

function renderQuestRewardSummary(quest: QuestDefinition): string {
  const r: any = quest?.reward ?? null;
  if (!r) return "";

  const parts: string[] = [];

  if (typeof r.xp === "number" && r.xp > 0) parts.push(`${r.xp} XP`);
  if (typeof r.gold === "number" && r.gold > 0) parts.push(`${r.gold}g`);

  const items = Array.isArray(r.items) ? r.items : [];
  if (items.length > 0) {
    const t = items
      .slice(0, 3)
      .map((it: any) => `${Number(it?.count ?? 1)}x ${String(it?.itemId ?? "?")}`)
      .join(", ");
    parts.push(`Items: ${t}${items.length > 3 ? ", …" : ""}`);
  }

  const titles = Array.isArray(r.titles) ? r.titles : [];
  if (titles.length > 0) {
    parts.push(`Titles: ${titles.slice(0, 3).join(", ")}${titles.length > 3 ? ", …" : ""}`);
  }

  const spellGrants = Array.isArray(r.spellGrants) ? r.spellGrants : [];
  if (spellGrants.length > 0) {
    const t = spellGrants
      .slice(0, 3)
      .map((g: any) => String(g?.spellId ?? "?"))
      .join(", ");
    parts.push(`Spells: ${t}${spellGrants.length > 3 ? ", …" : ""}`);
  }

  const abilityGrants = Array.isArray(r.abilityGrants) ? r.abilityGrants : [];
  if (abilityGrants.length > 0) {
    const t = abilityGrants
      .slice(0, 3)
      .map((g: any) => String(g?.abilityId ?? "?"))
      .join(", ");
    parts.push(`Abilities: ${t}${abilityGrants.length > 3 ? ", …" : ""}`);
  }

  return parts.join(" • ");
}
