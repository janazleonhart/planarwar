// worldcore/quests/turnInQuest.ts

import type { MudContext } from "../mud/MudContext";
import type { CharacterState, InventoryState } from "../characters/CharacterTypes";
import type { QuestDefinition, QuestObjective } from "./QuestTypes";
import { getQuestById, getAllQuests } from "./QuestRegistry";
import { ensureQuestState } from "./QuestState";
import { ensureProgression } from "../progression/ProgressionCore";
import {
  countItemInInventory,
  consumeItemFromInventory,
} from "../items/inventoryConsume";
import { giveGold } from "../economy/EconomyHelpers";
import { deliverItemsToBagsOrMail } from "../loot/OverflowDelivery";

/**
 * Turn in a quest by id or name.
 * - Verifies the quest exists.
 * - Verifies the quest is in "completed" state.
 * - Re-checks objectives (including collect_item) for safety.
 * - Preflights reward delivery (bags must fit if mail is unavailable).
 * - Consumes required items for collect_item objectives.
 * - Applies quest reward (XP/gold/items/titles).
 * - Updates repeatable/completion state and saves the character.
 */
export async function turnInQuest(
  ctx: MudContext,
  char: CharacterState,
  questIdRaw: string
): Promise<string> {
  const trimmed = questIdRaw.trim();
  if (!trimmed) return "[quest] Turn in which quest?";

  const quest = resolveQuestByIdOrName(trimmed);
  if (!quest) return `[quest] Unknown quest '${trimmed}'.`;

  const prog = ensureProgression(char);
  const questState = ensureQuestState(char);
  const entry = questState[quest.id];

  if (!entry || entry.state !== "completed") {
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
  if (!collectCheck.ok) return collectCheck.message ?? "[quest] You lack required items.";

  const reward = quest.reward;

  // Preflight reward delivery BEFORE consuming items / mutating quest state.
  // If mail is unavailable, reward items must fit in bags.
  if (reward?.items && reward.items.length > 0) {
    const pre = preflightRewardItems(ctx, char, reward.items);
    if (!pre.ok) {
      return (
        pre.message ??
        "[quest] Your bags are full and mailbox delivery is unavailable. Clear space and try again."
      );
    }
  }

  // Now consume all collect_item objectives
  consumeCollectItemsForQuest(quest, inv);

  const rewardMessages: string[] = [];

  if (reward) {
    // XP
    if (typeof reward.xp === "number" && reward.xp > 0 && (ctx as any).characters) {
      try {
        const updated = await (ctx as any).characters.grantXp(char.userId, char.id, reward.xp);
        if (updated) {
          (char as any).xp = updated.xp;
          (char as any).level = updated.level;
          (char as any).attributes = updated.attributes;
        }
        rewardMessages.push(`You gain ${reward.xp} XP.`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Failed to grant XP for quest turn-in", { err, charId: char.id, questId: quest.id });
      }
    }

    // Gold
    if (typeof reward.gold === "number" && reward.gold > 0) {
      giveGold(char, reward.gold);
      rewardMessages.push(`You receive ${reward.gold} gold.`);
    }

    // Items (bags-first; overflow-to-mail if mail is available)
    if (reward.items && reward.items.length > 0) {
      try {
        const deliveryCtx = {
          items: (ctx as any).items,
          mail: (ctx as any).mail,
          session: (ctx as any).session,
        };

        const deliver = await deliverItemsToBagsOrMail(deliveryCtx as any, {
          inventory: inv,
          items: reward.items
            .filter((it) => it.count > 0)
            .map((it) => ({ itemId: it.itemId, qty: it.count })),

          ownerId: char.userId,
          ownerKind: "account",

          sourceVerb: "turning in",
          sourceName: `quest '${quest.name}'`,
          mailSubject: "Quest reward",
          mailBody: `Your bags were full while turning in '${quest.name}'. Extra reward items were delivered to your mailbox.`,
        });

        if (deliver.results.length > 0) {
          const got = deliver.results
            .map((r) => r.added + r.mailed)
            .reduce((a, b) => a + b, 0);

          if (got > 0) {
            const parts = deliver.results
              .filter((r) => r.added + r.mailed > 0)
              .map((r) => `${r.added + r.mailed}x ${r.itemId}`);
            if (parts.length > 0) rewardMessages.push(`You receive: ${parts.join(", ")}.`);
          }

          // If something still couldn't be delivered, surface it loudly.
          const undelivered = deliver.results.filter((r) => (r as any).leftover > 0);
          if (undelivered.length > 0) {
            const stuck = undelivered.map((r) => `${(r as any).leftover}x ${r.itemId}`).join(", ");
            rewardMessages.push(
              `Some reward items could not be delivered (bags full and mail unavailable/failed): ${stuck}.`
            );
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Failed to grant quest reward items", { err, charId: char.id, questId: quest.id });
        rewardMessages.push("Some reward items could not be delivered due to an internal error.");
      }
    }

    // Titles
    if (reward.titles && reward.titles.length > 0) {
      const titles = prog.titles ?? { unlocked: [], active: null };
      prog.titles = titles;

      for (const t of reward.titles) {
        if (!titles.unlocked.includes(t)) titles.unlocked.push(t);
      }

      rewardMessages.push(`New titles unlocked: ${reward.titles.join(", ")}.`);
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
  if ((ctx as any).characters) {
    try {
      await (ctx as any).characters.patchCharacter(char.userId, char.id, {
        progression: char.progression,
        inventory: char.inventory,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("Failed to patch character after quest turn-in", { err, charId: char.id, questId: quest.id });
    }
  }

  let msg = `[quest] You turn in '${quest.name}'.`;
  if (isRepeatable) {
    const times = entry.completions ?? 0;
    msg += ` (Completed ${times}${max != null ? `/${max}` : ""} times.)`;
  }
  if (rewardMessages.length > 0) msg += " " + rewardMessages.join(" ");

  return msg;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveQuestByIdOrName(input: string): QuestDefinition | undefined {
  const lower = input.toLowerCase();

  const byId = getQuestById(input);
  if (byId) return byId;

  const all = getAllQuests();
  const idMatch = all.find((q) => q.id.toLowerCase() === lower);
  if (idMatch) return idMatch;

  return all.find((q) => q.name.toLowerCase() === lower);
}

function areObjectivesSatisfiedForTurnIn(quest: QuestDefinition, char: CharacterState): boolean {
  const prog = ensureProgression(char);
  const kills = prog.kills ?? {};
  const harvests = prog.harvests ?? {};
  const actions = prog.actions ?? {};
  const flags = prog.flags ?? {};
  const inv = (char.inventory ?? {}) as InventoryState;

  for (const obj of quest.objectives ?? []) {
    if (!isObjectiveSatisfied(obj, { kills, harvests, actions, flags, inv })) return false;
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

function consumeCollectItemsForQuest(quest: QuestDefinition, inv: InventoryState): void {
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

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function preflightRewardItems(
  ctx: MudContext,
  char: CharacterState,
  items: Array<{ itemId: string; count: number }>
): { ok: boolean; message?: string } {
  // If mail exists, overflow-to-mail means we don't need bag capacity.
  if ((ctx as any).mail) return { ok: true };

  const itemService = (ctx as any).items;
  if (!itemService || typeof itemService.addToInventory !== "function") {
    return {
      ok: false,
      message:
        "[quest] Cannot verify inventory space for rewards (mail unavailable). Please contact staff.",
    };
  }

  const simInv = deepClone(char.inventory);
  for (const it of items) {
    if (!it.itemId || it.count <= 0) continue;
    const r = itemService.addToInventory(simInv, it.itemId, it.count);
    if (r && typeof r.leftover === "number" && r.leftover > 0) {
      return {
        ok: false,
        message:
          "[quest] Your bags are full and mailbox delivery is unavailable. Clear space and try again.",
      };
    }
  }

  return { ok: true };
}
