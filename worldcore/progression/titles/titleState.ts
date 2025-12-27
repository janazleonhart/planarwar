// worldcore/progression/titles/titleState.ts

import type { CharacterState } from "../../characters/CharacterTypes";
import { ensureProgression } from "../ProgressionCore";
import { TITLES } from "../../characters/TitleTypes";

export interface TitleProgressState {
  unlocked: string[];
  active: string | null;
}

export function ensureTitlesContainer(char: CharacterState): TitleProgressState {
  const prog = ensureProgression(char);

  if (!prog.titles || typeof prog.titles !== "object") {
    prog.titles = {
      unlocked: [],
      active: null,
    };
  } else {
    if (!Array.isArray(prog.titles.unlocked)) {
      prog.titles.unlocked = [];
    }
    if (prog.titles.active === undefined) {
      prog.titles.active = null;
    }
  }

  return prog.titles as TitleProgressState;
}

export function updateTitlesFromProgress(char: CharacterState): string[] {
  const prog = ensureProgression(char);
  const kills = (prog.kills as Record<string, number>) || {};
  const harvests = (prog.harvests as Record<string, number>) || {};
  const titlesState = ensureTitlesContainer(char);

  const newlyUnlocked: string[] = [];

  for (const title of Object.values(TITLES)) {
    if (titlesState.unlocked.includes(title.id)) continue;

    let current = 0;
    if (title.unlock.type === "kill") {
      current = kills[title.unlock.target] ?? 0;
    } else if (title.unlock.type === "harvest") {
      current = harvests[title.unlock.target] ?? 0;
    }

    if (current >= title.unlock.required) {
      titlesState.unlocked.push(title.id);
      newlyUnlocked.push(title.id);
    }
  }

  return newlyUnlocked;
}
