//worldcore/progression/progressText.ts

import type { SimpleTask } from "./tasks/taskTypes"; 

export function renderProgressText(char: any): string {
  const prog = (char.progression as any) || {};
  const kills = (prog.kills as Record<string, number>) || {};
  const harvests = (prog.harvests as Record<string, number>) || {};
  const tasks = (prog.tasks as SimpleTask[]) || [];

  let out = "Progress:\n";

  const killEntries = Object.entries(kills);
  if (killEntries.length > 0) {
    out += " Kills:\n";
    for (const [k, v] of killEntries) out += `  - ${k}: ${v}\n`;
  } else {
    out += " Kills: none tracked yet.\n";
  }

  const harvEntries = Object.entries(harvests);
  if (harvEntries.length > 0) {
    out += " Harvests:\n";
    for (const [k, v] of harvEntries) out += `  - ${k}: ${v}\n`;
  } else {
    out += " Harvests: none tracked yet.\n";
  }

  if (tasks.length > 0) {
    out += " Tasks:\n";
    for (const t of tasks) {
      const current = t.type === "kill" ? (kills[t.target] ?? 0) : (harvests[t.target] ?? 0);
      const box = t.completed ? "[x]" : "[ ]";
      out += `  - ${box} ${t.id} (${current}/${t.required})\n`;
    }
  } else {
    out += " Tasks: none.\n";
  }

  return out.trimEnd();
}
