// worldcore/quests/QuestService.ts

import type { QuestDefinition, QuestObjective, QuestReward } from "./QuestTypes";

export interface QuestService {
  getQuest(id: string): Promise<QuestDefinition | null>;
  listQuests(): Promise<QuestDefinition[]>;

  // For admin tools later (can be no-op for now or implemented in web-backend)
  createOrUpdateQuest?(quest: QuestDefinition): Promise<void>;
  deleteQuest?(id: string): Promise<void>;
}
