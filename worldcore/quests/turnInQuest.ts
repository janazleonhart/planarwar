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
import { getQuestContextRoomId, getQuestContextTownId, resolveQuestDefinitionFromStateId } from "./TownQuestBoard";
import { grantSpellInState } from "../spells/SpellLearning";
import { grantAbilityInState } from "../abilities/AbilityLearning";
import { getSpellByIdOrAlias } from "../spells/SpellTypes";
import { findAbilityByNameOrId } from "../abilities/AbilityTypes";
import crypto from "node:crypto";

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
  // - 'quest turnin preview <#|id|name>' => show reward + objective readiness
  // - 'quest turnin all' => confirm-token gated bulk turn-in of all completed quests
  // - 'quest turnin <#>' => numeric index into quest log ordering (ids.sort())
  const lower = trimmed.toLowerCase();

  // ------------------------------------------------------------
  // Bulk turn-in (confirm-token gated)
  // ------------------------------------------------------------
  if (lower === "all" || lower.startsWith("all ")) {
    if (ids.length === 0) return "[quest] You have no accepted quests.";

    const completed = ids.filter((id) => questState[id]?.state === "completed");
    if (completed.length === 0) return "[quest] No completed quests are ready to turn in yet.";

    const providedToken = trimmed.split(/\s+/).slice(1).join(" ").trim();
    const token = computeTurnInAllToken(char, completed, questState);

    if (!providedToken) {
      const lines: string[] = [];
      lines.push(`[quest] Turn-in ALL ready quests: ${completed.length}`);
      lines.push("\nReady:");
      for (const id of completed) {
        const entry = questState[id];
        const q = resolveQuestDefinitionFromStateId(id, entry);
        const name = q?.name ?? id;
        const idx = ids.indexOf(id) + 1;
        const rewardText = q ? renderQuestRewardSummary(q) : "";
        lines.push(` - ${idx}) ${name} (${id})${rewardText ? ` • ${rewardText}` : ""}`);
      }
      lines.push("\nThis action is confirm-token gated to prevent oopsies.");
      lines.push(`Confirm with: quest turnin all ${token}`);
      return lines.join("\n").trimEnd();
    }

    if (providedToken !== token) {
      return [
        "[quest] Turn-in ALL denied: confirm token mismatch.",
        "Re-run: quest turnin all (to get a fresh token)",
      ].join("\n");
    }

    // Commit: sequentially turn in each quest. turnInQuest() already updates ctx.session.character.
    const results: string[] = [];
    for (const id of completed) {
      const current = (ctx as any)?.session?.character ?? char;
      const msg = await turnInQuest(ctx, current, id);
      results.push(msg);
    }

    const finalChar = (ctx as any)?.session?.character ?? char;
    const remaining = Object.keys(ensureQuestState(finalChar) as any)
      .sort()
      .filter((id) => (finalChar as any).progression?.quests?.[id]?.state === "completed");

    const footer = remaining.length > 0
      ? `\n[quest] Note: ${remaining.length} quests are still completed (likely repeatables capped or newly completed mid-turnin).`
      : "";

    return (`[quest] Turn-in ALL complete (${completed.length} attempted).\n` + results.join("\n") + footer).trimEnd();
  }

  // ------------------------------------------------------------
  // Preview
  // ------------------------------------------------------------
  if (lower === "preview" || lower.startsWith("preview ")) {
    const target = trimmed.split(/\s+/).slice(1).join(" ").trim();
    if (!target) return "Usage: quest turnin preview <#|id|name>";

    let key = target;
    if (/^\d+$/.test(target)) {
      const idx = Number(target);
      const id = ids[idx - 1];
      if (!id) return `[quest] You do not have a quest #${target}. (Use 'quest' to list accepted quests.)`;
      key = id;
    }

    const resolved = resolveQuestByIdOrNameIncludingAccepted(key, questState);
    if (!resolved) return `[quest] Unknown quest '${target}'.`;

    const quest = resolved.quest;
    const entry = questState[quest.id];
    if (!entry) return `[quest] You have not accepted '${quest.name}'.`;

    const objOk = areObjectivesSatisfiedForTurnIn(quest, char);
    const state = entry.state ?? "unknown";
    const rewardText = renderQuestRewardSummary(quest);

    const lines: string[] = [];
    lines.push(`[quest] Preview: ${quest.name} (${quest.id})`);
    lines.push(`State: ${state}${state === "completed" ? " (ready)" : ""}`);
    lines.push(`Objectives satisfied: ${objOk ? "YES" : "NO"}`);
const policy = String((quest as any).turninPolicy ?? "anywhere").trim() as any;
const policyCheck = enforceTurninPolicy(ctx, char, quest as any, entry, policy);
if (policy && policy !== "anywhere") {
  if ((policyCheck as any).ok) {
    lines.push("Can turn in here: YES");
  } else {
    const msg = String((policyCheck as any).message ?? "").replace(/^\[quest\]\s*/i, "").trim();
    lines.push("Can turn in here: NO");
    if (msg) lines.push(`Turn-in hint: ${msg}`);
  }
}
    if (rewardText) lines.push(`Rewards: ${rewardText}`);
    lines.push("\nTurn in with: quest turnin <#|id|name>");
    return lines.join("\n").trimEnd();
  }
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
      const rewardText = q ? renderQuestRewardSummary(q) : "";
      out += ` - ${idx}) ${name} (${id})${rewardText ? ` • ${rewardText}` : ""}\n`;
    }
    out += "\nUse: quest turnin <#|id|name> (or 'preview'/'all')";
    return out.trimEnd();
  }

  let key = trimmed;
  if (/^\d+$/.test(trimmed)) {
    const idx = Number(trimmed);
    // QoL: for turn-in, prefer indexing into the *ready* list first.
    // This matches player intent when they just ran `quest ready` / `quest turnin list`.
    const completedIds = ids.filter((id) => questState[id]?.state === "completed");
    const byReady = completedIds[idx - 1];
    const byAll = ids[idx - 1];

    const id = byReady ?? byAll;
    if (!id) {
      return `[quest] You do not have a quest #${trimmed}. (Use 'quest' to list accepted quests, or 'quest ready' for ready-to-turn-in.)`;
    }
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

  // Turn-in policy enforcement (Questloop v0.2)
  {
    const policy = (quest as any).turninPolicy ?? "anywhere";
    const enforced = enforceTurninPolicy(ctx, char, quest as any, entry, policy);
    if (!enforced.ok) return enforced.message;
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

    // Spells/Abilities (Rank system v0.2): grant as pending (not auto-learn)
    if ((reward as any).spellGrants && (reward as any).spellGrants.length > 0) {
      for (const g of (reward as any).spellGrants) {
        const spellId = String(g?.spellId ?? '').trim();
        if (!spellId) continue;

        // Hardening: a misconfigured DB-backed quest reward should not poison character state.
        // If the spell id doesn't exist in the catalog, skip the grant and surface the issue.
        const spellDef = getSpellByIdOrAlias(spellId);
        if (!spellDef) {
          // eslint-disable-next-line no-console
          console.warn("Quest reward spell_grant references unknown spellId", {
            questId: quest.id,
            questName: quest.name,
            spellId,
          });
          rewardMessages.push(
            `[quest] (Reward misconfigured: unknown spell '${spellId}'. It was not granted.)`
          );
          continue;
        }

        const res = grantSpellInState(char, spellId, g?.source ? String(g.source) : `quest:${quest.id}`);
        if (res && (res as any).ok) {
          char = (res as any).next;
          rewardMessages.push(`New spell granted: ${spellDef.name}. (Visit a trainer to learn higher ranks.)`);
        }
      }
    }

    if ((reward as any).abilityGrants && (reward as any).abilityGrants.length > 0) {
      for (const g of (reward as any).abilityGrants) {
        const abilityId = String(g?.abilityId ?? '').trim();
        if (!abilityId) continue;

        // Hardening: a misconfigured DB-backed quest reward should not poison character state.
        // If the ability id doesn't exist in the catalog, skip the grant and surface the issue.
        const abilityDef = findAbilityByNameOrId(abilityId);
        if (!abilityDef) {
          // eslint-disable-next-line no-console
          console.warn("Quest reward ability_grant references unknown abilityId", {
            questId: quest.id,
            questName: quest.name,
            abilityId,
          });
          rewardMessages.push(
            `[quest] (Reward misconfigured: unknown ability '${abilityId}'. It was not granted.)`
          );
          continue;
        }

        const res = grantAbilityInState(char, abilityId, g?.source ? String(g.source) : `quest:${quest.id}`);
        if (res && (res as any).ok) {
          char = (res as any).next;
          rewardMessages.push(`New ability granted: ${abilityDef.name}. (Visit a trainer to learn higher ranks.)`);
        }
      }
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
  // IMPORTANT: quest turn-in can grant pending spells/abilities. We must refresh the in-memory
  // session character, otherwise follow-up commands (train preview/train) won't see the grants.
  if (ctx.characters) {
    try {
      const updated = await ctx.characters.patchCharacter(char.userId, char.id, {
        progression: char.progression,
        inventory: char.inventory,
        spellbook: (char as any).spellbook,
        abilities: (char as any).abilities,
      });

      if (updated) {
        char = updated as any;
        if (ctx.session?.character && String(ctx.session.character.id) === String(char.id)) {
          ctx.session.character = char;
        }
      } else {
        // Patch API returned null (unexpected). Still update session from our local mutation.
        if (ctx.session?.character && String(ctx.session.character.id) === String(char.id)) {
          ctx.session.character = char;
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("Failed to patch character after quest turn-in", {
        err,
        charId: char.id,
        questId: quest.id,
      });

      // Even if persistence fails, keep the in-memory session in sync with the rewards we applied.
      if (ctx.session?.character && String(ctx.session.character.id) === String(char.id)) {
        ctx.session.character = char;
      }
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

function enforceTurninPolicy(
  ctx: any,
  char: any,
  quest: QuestDefinition,
  entry: any,
  policy: "anywhere" | "board" | "npc",
): { ok: true } | { ok: false; message: string } {
  if (!policy || policy === "anywhere") return { ok: true };

  // "npc": require a specific NPC proto id to be present in the player's current room.
  if (policy === "npc") {
    const npcId = String((quest as any).turninNpcId ?? "").trim();
    if (!npcId) {
      return {
        ok: false,
        message: "[quest] Turn-in denied: quest is configured for NPC turn-in, but no turninNpcId is set.",
      };
    }

    const roomId = getQuestContextRoomId(ctx, char);
    if (!roomId) {
      return {
        ok: false,
        message: `[quest] You must turn this in to ${npcId} (but your location is unknown).`,
      };
    }

    const ents = (ctx?.entities && typeof ctx.entities.getEntitiesInRoom === "function")
      ? (ctx.entities.getEntitiesInRoom(roomId) as any[])
      : [];

    const found = Array.isArray(ents)
      ? ents.some((e) => String(e?.type ?? "") === "npc" && String((e as any)?.protoId ?? "").trim() === npcId)
      : false;

    if (!found) {
      return {
        ok: false,
        message: `[quest] You must turn this in to ${npcId}. (Go to them, then run: quest turnin ${quest.id})`,
      };
    }

    return { ok: true };
  }

  // "board": require a town context (region id). If quest specifies a board id, it must match.
  if (policy === "board") {
    const townId = getQuestContextTownId(ctx, char);
    if (!townId) {
      return {
        ok: false,
        message: "[quest] You must be in a town (quest board context) to turn this quest in.",
      };
    }

    const requiredBoard = String((quest as any).turninBoardId ?? "").trim();
    if (requiredBoard && requiredBoard !== townId) {
      return {
        ok: false,
        message: `[quest] You must return to the quest board for this town to turn it in. (Required: ${requiredBoard}, here: ${townId})`,
      };
    }

    // Generated town quests implicitly bind to their source town if not explicitly set on the quest definition.
    const src = entry?.source;
    if (!requiredBoard && src?.kind === "generated_town") {
      const acceptedTown = String(src.townId ?? "").trim();
      if (acceptedTown && acceptedTown !== townId) {
        return {
          ok: false,
          message: `[quest] You must return to the quest board where you accepted this quest. (Required: ${acceptedTown}, here: ${townId})`,
        };
      }
    }

    return { ok: true };
  }

  return { ok: true };
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

function renderQuestRewardSummary(quest: QuestDefinition): string {
  const r: any = quest.reward ?? null;
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
  if (titles.length > 0) parts.push(`Titles: ${titles.slice(0, 3).join(", ")}${titles.length > 3 ? ", …" : ""}`);

  const spellGrants = Array.isArray((r as any).spellGrants) ? (r as any).spellGrants : [];
  if (spellGrants.length > 0) {
    const t = spellGrants
      .slice(0, 3)
      .map((g: any) => String(g?.spellId ?? "?") )
      .join(", ");
    parts.push(`Spells: ${t}${spellGrants.length > 3 ? ", …" : ""}`);
  }

  const abilityGrants = Array.isArray((r as any).abilityGrants) ? (r as any).abilityGrants : [];
  if (abilityGrants.length > 0) {
    const t = abilityGrants
      .slice(0, 3)
      .map((g: any) => String(g?.abilityId ?? "?") )
      .join(", ");
    parts.push(`Abilities: ${t}${abilityGrants.length > 3 ? ", …" : ""}`);
  }

  return parts.join(" • ");
}

function computeTurnInAllToken(
  char: CharacterState,
  completedQuestIds: string[],
  questState: Record<string, any>
): string {
  const base = [
    String(char.id),
    completedQuestIds.join(","),
    completedQuestIds.map((id) => String(questState?.[id]?.completions ?? 0)).join(","),
  ].join("|");

  return crypto.createHash("sha256").update(base).digest("hex").slice(0, 16);
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
