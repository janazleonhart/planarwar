// worldcore/mud/MudProgressionHooks.ts

import { MudContext } from "./MudContext";
import type { CharacterState } from "../characters/CharacterTypes";
import {
  updateTasksFromProgress,
  updateTitlesFromProgress,
  updateQuestsFromProgress,
} from "./MudProgression";
import { TITLES } from "../characters/TitleTypes";
import { grantTaskRewards } from "./MudHelperFunctions";

export type ProgressionCategory = "kills" | "harvests";

export interface ProgressionResultSnippets {
  snippets: string[];
}

/**
 * Shared MUD-side progression handler. Call this when something
 * happens that should advance kills/harvests.
 */
 export async function applyProgressionForEvent(
  ctx: MudContext,
  char: CharacterState,
  category: ProgressionCategory,
  key: string
): Promise<ProgressionResultSnippets> {
  // NOTE:
  // - applyProgressionEvent(...) is now called from the action handlers
  //   (e.g. attack / gather).
  // - Here we ONLY react to the *existing* progression state:
  //   tasks, titles, quests, rewards, DB patch.

  // 1) Tasks
  const { completed: newlyCompletedTasks } = updateTasksFromProgress(char);

  // 2) Titles
  const newlyUnlockedTitles = updateTitlesFromProgress(char);

  // 3) Quests
  const { completed: completedQuests } = updateQuestsFromProgress(char);

  // 4) Task rewards (XP/etc.)
  const rewardMessages = await grantTaskRewards(
    { characters: ctx.characters, session: ctx.session },
    char,
    newlyCompletedTasks
  );

  const snippets: string[] = [];

  if (newlyUnlockedTitles.length > 0) {
    const names = newlyUnlockedTitles
      .map((id) => TITLES[id]?.name ?? id)
      .join(", ");
    snippets.push(`[progress] You earned the title: ${names}.`);
  }

  if (completedQuests.length > 0) {
    const questNames = completedQuests.map((q) => q.name).join(", ");
    snippets.push(`[progress] Quest completed: ${questNames}.`);
  }

  if (rewardMessages.length > 0) {
    snippets.push(rewardMessages.join(" "));
  }

  // 5) Persist progression (lightweight patch – attack/harvest path)
  if (ctx.characters) {
    try {
      await ctx.characters.patchCharacter(char.userId, char.id, {
        progression: char.progression,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("Failed to patch progression after event", {
        err,
        charId: char.id,
        category,
        key,
      });
    }
  }

  return { snippets };
}

