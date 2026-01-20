// worldcore/quests/QuestState.ts

import type { CharacterState } from "../characters/CharacterTypes";
import { ensureProgression } from "../progression/ProgressionCore";

export type QuestSource =
  | {
      kind: "generated_town";
      townId: string;
      tier: number;
      epoch: string;
    }
  | {
      // default / legacy
      kind: "registry";
    };

export interface QuestStateEntry {
  /**
   * Quests are NOT implicitly active anymore.
   * A quest exists in this map only if the player accepted (or otherwise started) it.
   */
  state: "active" | "completed" | "turned_in";

  /**
   * Number of times this quest has been fully turned in.
   * Only really matters for repeatable quests.
   */
  completions?: number;

  /**
   * Optional metadata for resolving quest definitions that aren't in QuestRegistry
   * (ex: deterministic town-generated quests).
   */
  source?: QuestSource;
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
