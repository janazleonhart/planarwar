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
import { getQuestContextRoomId, getTownContextForTurnin, resolveQuestDefinitionFromStateId } from "./TownQuestBoard";
import { enforceTurninPolicy } from "./QuestTurninPolicy";
import { grantSpellInState } from "../spells/SpellLearning";
import { grantAbilityInState } from "../abilities/AbilityLearning";
import { getSpellByIdOrAlias } from "../spells/SpellTypes";
import { findAbilityByNameOrId } from "../abilities/AbilityTypes";
import { renderQuestAmbiguous } from "./QuestCommandText";
import crypto from "node:crypto";


function parseRewardChoiceSuffix(input: string): { questQuery: string; choiceIndex: number | null } {
  const raw = input.trim();
  if (!raw) return { questQuery: "", choiceIndex: null };

  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length < 3) return { questQuery: raw, choiceIndex: null };

  const last = parts[parts.length - 1];
  const prev = parts[parts.length - 2].toLowerCase();
  const n = Number(last);

  if (!Number.isInteger(n) || n <= 0) return { questQuery: raw, choiceIndex: null };

  if (prev === "choose" || prev === "choice" || prev === "pick") {
    const questQuery = parts.slice(0, -2).join(" ").trim();
    return { questQuery, choiceIndex: n };
  }

  return { questQuery: raw, choiceIndex: null };
}

function renderRewardChoiceOptionSummary(opt: any): string {
  if (!opt || typeof opt !== "object") return "(none)";

  const label = String(opt.label ?? "").trim();
  const xp = typeof opt.xp === "number" && opt.xp > 0 ? `${opt.xp} XP` : "";
  const gold = typeof opt.gold === "number" && opt.gold > 0 ? `${opt.gold} gold` : "";

  const items = Array.isArray(opt.items) && opt.items.length
    ? opt.items
        .slice(0, 5)
        .map((it: any) => {
          const qty = Number(it?.count ?? it?.quantity ?? 1);
          const itemId = String(it?.itemId ?? "").trim();
          return itemId ? `${qty}x ${itemId}` : "";
        })
        .filter(Boolean)
        .join(", ")
    : "";
  const itemsSuffix = Array.isArray(opt.items) && opt.items.length > 5 ? " …" : "";

  const titles = Array.isArray(opt.titles) && opt.titles.length
    ? `titles: ${opt.titles.slice(0, 5).join(", ")}${opt.titles.length > 5 ? " …" : ""}`
    : "";

  const bits = [label, xp, gold, items ? `${items}${itemsSuffix}` : "", titles].filter(Boolean);
  return bits.length ? bits.join(" • ") : "(none)";
}


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
  const { questQuery, choiceIndex } = parseRewardChoiceSuffix(trimmed);

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
  const lower = questQuery.toLowerCase();

  // ------------------------------------------------------------
  // Bulk turn-in (confirm-token gated)
  // ------------------------------------------------------------
  if (lower === "all" || lower.startsWith("all ")) {
    if (ids.length === 0) return "[quest] You have no accepted quests.";

    let completed = ids.filter((id) => questState[id]?.state === "completed");
    if (completed.length === 0) return "[quest] No completed quests are ready to turn in yet.";

    const parts = trimmed.split(/\s+/).filter(Boolean);
    const wantsHere = (parts[1] ?? "").toLowerCase();
    const isHere = wantsHere === "here" || wantsHere === "local";

    // Optional flags:
    //  - --preview / -p : show eligible list but do NOT emit a confirm token (no commit)
    const rawArgs = isHere ? parts.slice(2) : parts.slice(1);
    const flags = new Set(rawArgs.map((p) => p.toLowerCase()));
    const previewOnly = flags.has("--preview") || flags.has("-p");
    const argsNoFlags = rawArgs.filter((p) => {
      const l = p.toLowerCase();
      return l !== "--preview" && l !== "-p";
    });

    if (isHere) {
      completed = completed.filter((id) => {
        const entry = questState[id];
        const q = resolveQuestDefinitionFromStateId(id, entry);
        if (!q) return true; // legacy: don't over-filter when we can't resolve definition
        const enforced = enforceTurninPolicy(ctx, char as any, q as any, entry, (q as any).turninPolicy ?? "anywhere");
        return enforced.ok;
      });
    }

    if (completed.length === 0) {
      return "[quest] None ready to turn in here.";
    }

    const providedToken = argsNoFlags.join(" ").trim();
    const token = computeTurnInAllToken(char, completed, questState);

    if (previewOnly) {
      const lines: string[] = [];
      lines.push(`[quest] Turn-in ALL ready quests${isHere ? " (here)" : ""}: ${completed.length}`);
      lines.push("\nReady:");
      for (const id of completed) {
        const entry = questState[id];
        const q = resolveQuestDefinitionFromStateId(id, entry);
        const name = q?.name ?? id;
        const idx = ids.indexOf(id) + 1;
        const rewardText = q ? renderQuestRewardSummary(q) : "";
        lines.push(` - ${idx}) ${name} (${id})${rewardText ? ` • ${rewardText}` : ""}`);
      }
      lines.push("\n[quest] (preview) No confirm token generated.");
      lines.push(`Run: quest turnin all${isHere ? " here" : ""}  (to get a confirm token)`);
      return lines.join("\n").trimEnd();
    }

    if (!providedToken) {
      const lines: string[] = [];
      lines.push(`[quest] Turn-in ALL ready quests${isHere ? " (here)" : ""}: ${completed.length}`);
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
      lines.push(`Confirm with: quest turnin all${isHere ? " here" : ""} ${token}`);
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
    if (resolved.kind === "ambiguous") {
      return renderQuestAmbiguous(resolved.matches);
    }

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
    if ((policyCheck as any).ok) {
      lines.push("Can turn in here: YES");
    } else {
      const msg = String((policyCheck as any).message ?? "").replace(/^\[quest\]\s*/i, "").trim();
      lines.push("Can turn in here: NO");
      if (msg) lines.push(`Turn-in hint: ${msg}`);
    }
    if (rewardText) lines.push(`Rewards: ${rewardText}`);
    if (policy === "npc") {
      const npcId = String((quest as any).turninNpcId ?? "").trim();
      if (npcId && (policyCheck as any).ok) {
        lines.push(`\nTurn in with: handin ${npcId}   (or: quest turnin ${quest.id})`);
      } else {
        lines.push("\nTurn in with: quest turnin <#|id|name>");
      }
    } else {
      lines.push("\nTurn in with: quest turnin <#|id|name>");
    }
    return lines.join("\n").trimEnd();
  }
  
if (
  lower === "list" ||
  lower === "ready" ||
  lower.startsWith("list ") ||
  lower.startsWith("ready ")
) {
  if (ids.length === 0) return "[quest] You have no accepted quests.";

  const parts = trimmed.split(/\s+/).filter(Boolean);
  const wantsHere = (parts[1] ?? "").toLowerCase();
  const isHere = wantsHere === "here" || wantsHere === "local";

  let completed = ids.filter((id) => questState[id]?.state === "completed");
  if (completed.length === 0) return "[quest] No completed quests are ready to turn in yet.";

  if (isHere) {
    completed = completed.filter((id) => {
      const entry = questState[id];
      const q = resolveQuestDefinitionFromStateId(id, entry);
      if (!q) return true; // legacy: if we can't resolve definition, don't over-filter
      const policy = (q as any).turninPolicy ?? "anywhere";
      const enforced = enforceTurninPolicy(ctx, char, q as any, entry, policy);
      return enforced.ok;
    });
  }

  if (completed.length === 0) {
    return "[quest] None ready to turn in here.";
  }

  const header = isHere
    ? "[quest] Completed quests ready to turn in here:\n"
    : "[quest] Completed quests ready to turn in:\n";

  let out = header;
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

  let key = questQuery;
  if (/^\d+$/.test(questQuery)) {
    const idx = Number(questQuery);
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
    return `[quest] Unknown quest '${questQuery}'.`;
  }
  if (resolved.kind === "ambiguous") {
    return renderQuestAmbiguous(resolved.matches);
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



  // Reward-choice enforcement (Quest Rewards v0.1)
  // If the quest offers choose-one rewards, the player must pick an option at turn-in time.
  const chooseOne = ((quest as any).reward as any)?.chooseOne as any[] | undefined;
  let chosenBundle: any | null = null;
  if (Array.isArray(chooseOne) && chooseOne.length > 0) {
    if (choiceIndex == null) {
      const opts = chooseOne
        .map((opt, i) => ` (${i + 1}) ${renderRewardChoiceOptionSummary(opt)}`)
        .join("\n");

      return [
        "[quest] This quest requires choosing a reward.",
        `Use: quest turnin ${quest.id} choose <#>`,
        "(Tip: the same 'choose <#>' suffix works with handin/talk turn-ins too.)",
        "Options:",
        opts,
      ].join("\n").trimEnd();
    }

    if (choiceIndex < 1 || choiceIndex > chooseOne.length) {
      return `[quest] Invalid reward choice. Choose 1-${chooseOne.length}. (Use: quest turnin ${quest.id} choose <#>)`;
    }

    chosenBundle = chooseOne[choiceIndex - 1];
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
  

    // Apply chosen reward bundle (Quest Rewards v0.1)
    if (chosenBundle) {
      const choice: any = chosenBundle;

      // XP
      if (typeof choice.xp === "number" && choice.xp > 0 && ctx.characters) {
        try {
          const updated = await ctx.characters.grantXp(char.userId, char.id, choice.xp);
          if (updated) {
            (char as any).xp = updated.xp;
            (char as any).level = updated.level;
            (char as any).attributes = updated.attributes;
          }
          rewardMessages.push(`You gain ${choice.xp} XP.`);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("Failed to grant XP (choice reward) for quest turn-in", {
            err,
            charId: char.id,
            questId: quest.id,
          });
        }
      }

      // Gold
      if (typeof choice.gold === "number" && choice.gold > 0) {
        try {
          const econ = grantReward(char, { gold: choice.gold, items: [] });
          if (econ.goldGranted > 0) rewardMessages.push(`You receive ${econ.goldGranted} gold.`);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("Failed to grant gold (choice reward) for quest turn-in", {
            err,
            charId: char.id,
            questId: quest.id,
          });
        }
      }

      // Items (never drop)
      if (choice.items && choice.items.length > 0) {
        try {
          const res = await deliverRewardItemsNeverDrop(
            { items: (ctx as any).items, mail: (ctx as any).mail, session: (ctx as any).session },
            char,
            inv,
            choice.items.map((it: any) => ({ itemId: it.itemId, qty: it.count })),
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
            const itemsText = got.map((st: any) => `${st.qty}x ${st.itemId}`).join(", ");
            rewardMessages.push(`You receive: ${itemsText}.`);
          }

          if (res.queued.length > 0) {
            const stuckText = res.queued.map((st: any) => `${st.qty}x ${st.itemId}`).join(", ");
            rewardMessages.push(`Some items could not be delivered and were queued: ${stuckText}. (Use 'reward claim')`);
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("Failed to grant quest items (choice reward)", {
            err,
            charId: char.id,
            questId: quest.id,
          });
        }
      }

      // Titles
      if (choice.titles && choice.titles.length > 0) {
        const titles = prog.titles ?? { unlocked: [], active: null };
        prog.titles = titles;

        for (const t of choice.titles) {
          if (!titles.unlocked.includes(t)) titles.unlocked.push(t);
        }

        rewardMessages.push(`New titles unlocked: ${choice.titles.join(", ")}.`);
      }

      // Spells/Abilities (pending grants)
      if (choice.spellGrants && choice.spellGrants.length > 0) {
        for (const g of choice.spellGrants) {
          const spellId = String(g?.spellId ?? '').trim();
          if (!spellId) continue;
          const spellDef = getSpellByIdOrAlias(spellId);
          if (!spellDef) {
            // eslint-disable-next-line no-console
            console.warn("Quest choice reward spell_grant references unknown spellId", { questId: quest.id, spellId });
            rewardMessages.push(`[quest] (Reward misconfigured: unknown spell '${spellId}'. It was not granted.)`);
            continue;
          }
          const res = grantSpellInState(char, spellId, g?.source ? String(g.source) : `quest:${quest.id}`);
          if (res && (res as any).ok) {
            char = (res as any).next;
            rewardMessages.push(`New spell granted: ${spellDef.name}. (Visit a trainer to learn higher ranks.)`);
          }
        }
      }

      if (choice.abilityGrants && choice.abilityGrants.length > 0) {
        for (const g of choice.abilityGrants) {
          const abilityId = String(g?.abilityId ?? '').trim();
          if (!abilityId) continue;
          const abilityDef = findAbilityByNameOrId(abilityId);
          if (!abilityDef) {
            // eslint-disable-next-line no-console
            console.warn("Quest choice reward ability_grant references unknown abilityId", { questId: quest.id, abilityId });
            rewardMessages.push(`[quest] (Reward misconfigured: unknown ability '${abilityId}'. It was not granted.)`);
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

  const unlocks = Array.isArray((quest as any).unlocks) ? ((quest as any).unlocks as string[]) : [];
  if (unlocks.length > 0) {
    const names = unlocks.map((id) => getQuestById(id)?.name ?? id).join(", ");
    msg += ` [quest] Unlocked: ${names}.`;
  }

  return msg;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type QuestResolveResult =
  | { kind: "single"; quest: QuestDefinition }
  | { kind: "ambiguous"; matches: QuestDefinition[] };

function resolveQuestByIdOrNameIncludingAccepted(
  inputRaw: string,
  questState: Record<string, any>
): QuestResolveResult | null {
  const input = String(inputRaw ?? "").trim();
  if (!input) return null;

  const lower = input.toLowerCase();

  // Accepted quests (generated or registry accepted)
  const accepted: QuestDefinition[] = [];
  for (const [id, entry] of Object.entries(questState)) {
    const q = resolveQuestDefinitionFromStateId(id, entry);
    if (q) accepted.push(q);
  }

  // 1) Exact accepted id
  if (questState[input]) {
    const q = resolveQuestDefinitionFromStateId(input, questState[input]);
    if (q) return { kind: "single", quest: q };
  }

  // 2) Exact registry id
  const byId = getQuestById(input);
  if (byId) return { kind: "single", quest: byId };

  // 3) Exact case-insensitive among accepted (prefer accepted)
  const exact = (q: QuestDefinition) =>
    q.id.toLowerCase() === lower || q.name.toLowerCase() === lower;

  const starts = (q: QuestDefinition) =>
    q.id.toLowerCase().startsWith(lower) || q.name.toLowerCase().startsWith(lower);

  const contains = (q: QuestDefinition) =>
    q.id.toLowerCase().includes(lower) || q.name.toLowerCase().includes(lower);

  const exactAccepted = accepted.filter(exact);
  if (exactAccepted.length === 1) return { kind: "single", quest: exactAccepted[0] };
  if (exactAccepted.length > 1) return { kind: "ambiguous", matches: exactAccepted };

  const registry = getAllQuests();

  const exactRegistry = registry.filter(exact);
  if (exactRegistry.length === 1) return { kind: "single", quest: exactRegistry[0] };
  if (exactRegistry.length > 1) return { kind: "ambiguous", matches: exactRegistry };

  // 4) Prefix fuzzy (prefer accepted)
  const prefixAccepted = accepted.filter(starts);
  if (prefixAccepted.length === 1) return { kind: "single", quest: prefixAccepted[0] };
  if (prefixAccepted.length > 1) return { kind: "ambiguous", matches: prefixAccepted };

  const prefixRegistry = registry.filter(starts);
  if (prefixRegistry.length === 1) return { kind: "single", quest: prefixRegistry[0] };
  if (prefixRegistry.length > 1) return { kind: "ambiguous", matches: prefixRegistry };

  // 5) Substring fuzzy across accepted+registry (unique by id)
  const uniq: QuestDefinition[] = [];
  const seen = new Set<string>();
  for (const q of [...accepted, ...registry]) {
    if (!q || !q.id) continue;
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    uniq.push(q);
  }

  const fuzzyAll = uniq.filter(contains);
  if (fuzzyAll.length === 1) return { kind: "single", quest: fuzzyAll[0] };
  if (fuzzyAll.length > 1) return { kind: "ambiguous", matches: fuzzyAll };

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
