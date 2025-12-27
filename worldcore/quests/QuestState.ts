// worldcore/quests/QuestState.ts

import type { CharacterState } from "../characters/CharacterTypes";
import { ensureProgression } from "../progression/ProgressionCore";

export interface QuestStateEntry {
  state: "active" | "completed" | "turned_in";

  /**
   * Number of times this quest has been fully turned in.
   * Only really matters for repeatable quests.
   */
  completions?: number;
}

export interface QuestStateMap {
  [id: string]: QuestStateEntry;
}

export function ensureQuestState(char: CharacterState): QuestStateMap {
  const prog = ensureProgression(char);
  if (!prog.quests || typeof prog.quests !== "object") {
    prog.quests = {};
  }
  return prog.quests as QuestStateMap;
}
