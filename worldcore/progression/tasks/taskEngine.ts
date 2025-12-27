// worldcore/progression/tasks/taskEngine.ts

import { ensureProgression } from "../ProgressionCore";

import type { CharacterState } from "../../characters/CharacterTypes";
import type { SimpleTask } from "./taskTypes";

export function ensureTaskList(char: CharacterState): SimpleTask[] {
  const prog = ensureProgression(char);

  if (!Array.isArray(prog.tasks)) {
    prog.tasks = [];
  }

  return prog.tasks as SimpleTask[];
}

export function updateTasksFromProgress(char: CharacterState): {
  completed: SimpleTask[];
} {
  const prog = ensureProgression(char);
  const tasks = ensureTaskList(char);

  const kills = (prog.kills as Record<string, number>) || {};
  const harvests = (prog.harvests as Record<string, number>) || {};

  const newlyCompleted: SimpleTask[] = [];

  for (const t of tasks) {
    if (t.completed) continue;

    const current =
      t.type === "kill"
        ? (kills[t.target] ?? 0)
        : (harvests[t.target] ?? 0);

    if (current >= t.required) {
      t.completed = true;
      newlyCompleted.push(t);
    }
  }

  return { completed: newlyCompleted };
}
