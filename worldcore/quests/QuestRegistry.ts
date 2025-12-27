// worldcore/quests/QuestRegistry.ts

import type { QuestDefinition } from "./QuestTypes";
import { QUESTS as HARDCODED_QUESTS } from "./QuestTypes";

// Start with the hardcoded quests as a fallback.
let questMap: Record<string, QuestDefinition> = { ...HARDCODED_QUESTS };

export function setQuestDefinitions(defs: QuestDefinition[]): void {
  const next: Record<string, QuestDefinition> = {};
  for (const q of defs) {
    next[q.id] = q;
  }
  questMap = next;
}

export function getQuestById(id: string): QuestDefinition | undefined {
  return questMap[id];
}

export function getAllQuests(): QuestDefinition[] {
  return Object.values(questMap);
}
