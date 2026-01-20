// worldcore/quests/turnInQuest.ts

import type { MudContext } from "../mud/MudContext";
import type { CharacterState, InventoryState } from "../characters/CharacterTypes";
import type { QuestDefinition, QuestObjective } from "./QuestTypes";
import { getQuestById, getAllQuests } from "./QuestRegistry";
import { ensureQuestState } from "./QuestState";
import { ensureProgression } from "../progression/ProgressionCore";
import { countItemInInventory, consumeItemFromInventory } from "../items/inventoryConsume";
import { grantReward } from "../economy/EconomyHelpers";
import {
  deliverRewardItemsNeverDrop,
  preflightBagsForRewards,
} from "../rewards/RewardDelivery";
import { resolveQuestDefinitionFromStateId } from "./TownQuestBoard";

/**
 * Turn in a quest by id or name.
 * Supports both registry quests and deterministic generated quests (accepted via quest board).
 */
export async function turnInQuest(
  ctx: MudContext,
  char: CharacterState,
  questIdRaw: string
): Promise<string> {
  const trimmed = questIdRaw.trim();
  if (!trimmed) {
    return "[quest] Turn in which quest?";
  }

  const prog = ensureProgression(char);
  const questState = ensureQuestState(char);
  const ids = Object.keys(questState).sort();

  // Warfront-friendly helpers:
  // - 'quest turnin list' / 'quest turnin ready' => show completed quests ready to cash in
  // - 'quest turnin <#>' => numeric index into quest log ordering (ids.sort())
  const lower = trimmed.toLowerCase();
  if (lower === "list" || lower === "ready") {
    if (ids.length === 0) return "[quest] You have no accepted quests.";

    const completed = ids.filter((id) => questState[id]?.state === "completed");
    if (completed.length === 0) return "[quest] No completed quests are ready to turn in yet.";

    let out = "[quest] Completed quests ready to turn in:\n";
    for (const id of completed) {
      const entry = questState[id];
      const q = resolveQuestDefinitionFromStateId(id, entry);
      const name = q?.name ?? id;
      const idx = ids.indexOf(id) + 1;
      out += ` - ${idx}) ${name} (${id})\n`;
    }
    out += "\nUse: quest turnin <#|id|name>";
    return out.trimEnd();
  }

  let key = trimmed;
  if (/^\d+$/.test(trimmed)) {
    const idx = Number(trimmed);
    const id = ids[idx - 1];
    if (!id) return `[quest] You do not have a quest #${trimmed}. (Use 'quest' to list accepted quests.)`;
    key = id;
  }


  const resolved = resolveQuestByIdOrNameIncludingAccepted(key, questState);
  if (!resolved) {
    return `[quest] Unknown quest '${trimmed}'.`;
  }

  const quest = resolved.quest;
  const entry = questState[quest.id];

  if (!entry) {
    return `[quest] You have not accepted '${quest.name}'.`;
  }
  if (entry.state !== "completed") {
    return `[quest] '${quest.name}' is not ready to turn in yet.`;
  }

  const isRepeatable = quest.repeatable === true;
  const max = quest.maxCompletions ?? null;
  const completions = entry.completions ?? 0;

  if (!isRepeatable && completions > 0) {
    return `[quest] You have already turned in '${quest.name}'.`;
  }
  if (isRepeatable && max != null && completions >= max) {
    return `[quest] You cannot turn in '${quest.name}' any more times.`;
  }

  // Re-check objectives from progression + inventory for safety
  if (!areObjectivesSatisfiedForTurnIn(quest, char)) {
    return `[quest] You have not actually completed '${quest.name}' yet.`;
  }

  const inv = (char.inventory ?? {}) as InventoryState;

  // Check collect_item requirements before consuming
  const collectCheck = ensureCollectItemsAvailableForQuest(quest, inv);
  if (!collectCheck.ok) {
    return collectCheck.message ?? `[quest] You lack required items.`;
  }

  // PRE-FLIGHT: if mail is unavailable, ensure reward items will fit before consuming collect items.
  const rewardItems = (quest.reward?.items ?? []).map((it) => ({
    itemId: it.itemId,
    qty: it.count,
  }));

  if (rewardItems.length > 0) {
    const pre = preflightBagsForRewards(
      { items: (ctx as any).items, mail: (ctx as any).mail, session: (ctx as any).session },
      inv,
      rewardItems
    );

    if (!pre.ok) {
      return "[quest] Your bags are full. Clear space (or enable mail) before turning this in.";
    }
  }

  // Now consume all collect_item objectives
  consumeCollectItemsForQuest(quest, inv);

  const rewardMessages: string[] = [];
  const reward = quest.reward;

  if (reward) {
    // XP
    if (typeof reward.xp === "number" && reward.xp > 0 && ctx.characters) {
      try {
        const updated = await ctx.characters.grantXp(
          char.userId,
          char.id,
          reward.xp
        );
        if (updated) {
          (char as any).xp = updated.xp;
          (char as any).level = updated.level;
          (char as any).attributes = updated.attributes;
        }
        rewardMessages.push(`You gain ${reward.xp} XP.`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Failed to grant XP for quest turn-in", {
          err,
          charId: char.id,
          questId: quest.id,
        });
      }
    }

    // Gold
    if (typeof reward.gold === "number" && reward.gold > 0) {
      try {
        const econ = grantReward(char, { gold: reward.gold, items: [] });
        if (econ.goldGranted > 0) {
          rewardMessages.push(`You receive ${econ.goldGranted} gold.`);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Failed to grant gold for quest turn-in", {
          err,
          charId: char.id,
          questId: quest.id,
        });
      }
    }

    // Items (never drop)
    if (reward.items && reward.items.length > 0) {
      try {
        const res = await deliverRewardItemsNeverDrop(
          { items: (ctx as any).items, mail: (ctx as any).mail, session: (ctx as any).session },
          char,
          inv,
          reward.items.map((it) => ({ itemId: it.itemId, qty: it.count })),
          {
            source: `quest turn-in: ${quest.name}`,
            ownerId: (ctx as any).session?.identity?.userId,
            ownerKind: "account",
            mailSubject: `Quest reward: ${quest.name}`,
            mailBody: `Your bags were full while receiving quest rewards for '${quest.name}'.\nExtra items were delivered to your mailbox.`,
          }
        );

        const got = [...res.deliveredToBags, ...res.mailed];
        if (got.length > 0) {
          const itemsText = got
            .map((st) => `${st.qty}x ${st.itemId}`)
            .join(", ");
          rewardMessages.push(`You receive: ${itemsText}.`);
        }

        if (res.queued.length > 0) {
          const stuckText = res.queued
            .map((st) => `${st.qty}x ${st.itemId}`)
            .join(", ");
          rewardMessages.push(
            `Some items could not be delivered and were queued: ${stuckText}. (Use 'reward claim')`
          );
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Failed to grant quest items", {
          err,
          charId: char.id,
          questId: quest.id,
        });
      }
    }

    // Titles
    if (reward.titles && reward.titles.length > 0) {
      const titles = prog.titles ?? { unlocked: [], active: null };
      prog.titles = titles;

      for (const t of reward.titles) {
        if (!titles.unlocked.includes(t)) {
          titles.unlocked.push(t);
        }
      }

      const text = reward.titles.join(", ");
      rewardMessages.push(`New titles unlocked: ${text}.`);
    }
  }

  // Update quest state + completions
  entry.completions = (entry.completions ?? 0) + 1;

  if (isRepeatable) {
    const reachedMax = max != null && entry.completions >= max;
    entry.state = reachedMax ? "turned_in" : "active";
  } else {
    entry.state = "turned_in";
  }

  // Persist progression + inventory
  if (ctx.characters) {
    try {
      await ctx.characters.patchCharacter(char.userId, char.id, {
        progression: char.progression,
        inventory: char.inventory,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("Failed to patch character after quest turn-in", {
        err,
        charId: char.id,
        questId: quest.id,
      });
    }
  }

  let msg = `[quest] You turn in '${quest.name}'.`;
  if (isRepeatable) {
    const times = entry.completions ?? 0;
    msg += ` (Completed ${times}${max != null ? `/${max}` : ""} times.)`;
  }
  if (rewardMessages.length > 0) {
    msg += " " + rewardMessages.join(" ");
  }

  return msg;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function areObjectivesSatisfiedForTurnIn(
  quest: QuestDefinition,
  char: CharacterState
): boolean {
  const prog = ensureProgression(char);
  const kills = prog.kills ?? {};
  const harvests = prog.harvests ?? {};
  const actions = prog.actions ?? {};
  const flags = prog.flags ?? {};
  const inv = (char.inventory ?? {}) as InventoryState;

  for (const obj of quest.objectives ?? []) {
    if (!isObjectiveSatisfied(obj, { kills, harvests, actions, flags, inv })) {
      return false;
    }
  }
  return true;
}

function isObjectiveSatisfied(
  obj: QuestObjective,
  ctx: {
    kills: Record<string, number>;
    harvests: Record<string, number>;
    actions: Record<string, number>;
    flags: Record<string, unknown>;
    inv: InventoryState;
  }
): boolean {
  const { kills, harvests, actions, flags, inv } = ctx;

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

function ensureCollectItemsAvailableForQuest(
  quest: QuestDefinition,
  inv: InventoryState
): { ok: boolean; message?: string } {
  const needed: Record<string, number> = {};

  for (const obj of quest.objectives ?? []) {
    if (obj.kind !== "collect_item") continue;
    needed[obj.itemId] = (needed[obj.itemId] ?? 0) + obj.required;
  }

  for (const [itemId, required] of Object.entries(needed)) {
    const have = countItemInInventory(inv, itemId);
    if (have < required) {
      return {
        ok: false,
        message: `[quest] You need ${required}x ${itemId} (you only have ${have}).`,
      };
    }
  }

  return { ok: true };
}

function consumeCollectItemsForQuest(
  quest: QuestDefinition,
  inv: InventoryState
): void {
  const needed: Record<string, number> = {};

  for (const obj of quest.objectives ?? []) {
    if (obj.kind !== "collect_item") continue;
    needed[obj.itemId] = (needed[obj.itemId] ?? 0) + obj.required;
  }

  for (const [itemId, required] of Object.entries(needed)) {
    if (required <= 0) continue;
    consumeItemFromInventory(inv, itemId, required);
  }
}
