// worldcore/mud/MudProgression.ts

import { CharacterState, ProgressionState } from "../characters/CharacterTypes";

import {
  ensureProgression as coreEnsureProgression,
  incrementProgressionCounter as coreIncrementProgressionCounter,
  recordActionProgress as coreRecordActionProgress,
  ProgressionCategory as CoreProgressionCategory,
} from "../progression/ProgressionCore";

import { SimpleTask as CoreSimpleTask } from "../progression/tasks/taskTypes";
import {
  ensureTaskList as coreEnsureTaskList,
  updateTasksFromProgress as coreUpdateTasksFromProgress,
} from "../progression/tasks/taskEngine";

import {
  TitleProgressState as CoreTitleProgressState,
  ensureTitlesContainer as coreEnsureTitlesContainer,
  updateTitlesFromProgress as coreUpdateTitlesFromProgress,
} from "../progression/titles/titleState";

import {
  QuestStateEntry as CoreQuestStateEntry,
  QuestStateMap as CoreQuestStateMap,
  ensureQuestState as coreEnsureQuestState,
} from "../quests/QuestState";

import {
  updateQuestsFromProgress as coreUpdateQuestsFromProgress,
} from "../quests/QuestEngine";

import {
  renderQuestLog as coreRenderQuestLog,
} from "../quests/QuestText";


// ---------- progression root ----------

export type ProgressionCategory = CoreProgressionCategory;

export function ensureProgression(char: CharacterState): ProgressionState {
  return coreEnsureProgression(char);
}

export function incrementProgressionCounter(
  char: CharacterState,
  category: ProgressionCategory,
  key: string,
  amount: number = 1,
): void {
  return coreIncrementProgressionCounter(char, category, key, amount);
}

export function recordActionProgress(
  char: CharacterState,
  key: string,
  amount: number = 1,
): void {
  return coreRecordActionProgress(char, key, amount);
}

// ---------- tasks (per-character mini-objectives) ----------

export type SimpleTask = CoreSimpleTask;

export function ensureTaskList(char: CharacterState): SimpleTask[] {
  return coreEnsureTaskList(char);
}

export function updateTasksFromProgress(char: CharacterState) {
  return coreUpdateTasksFromProgress(char);
}

// ---------- titles ----------

export type TitleProgressState = CoreTitleProgressState;

export function ensureTitlesContainer(char: CharacterState) {
  return coreEnsureTitlesContainer(char);
}

export function updateTitlesFromProgress(char: CharacterState) {
  return coreUpdateTitlesFromProgress(char);
}

// ---------- quests ----------

export type QuestStateEntry = CoreQuestStateEntry;
export type QuestStateMap = CoreQuestStateMap;

export function ensureQuestState(char: CharacterState) {
  return coreEnsureQuestState(char);
}

export function updateQuestsFromProgress(char: CharacterState) {
  return coreUpdateQuestsFromProgress(char);
}

export function renderQuestLog(char: CharacterState) {
  return coreRenderQuestLog(char);
}
