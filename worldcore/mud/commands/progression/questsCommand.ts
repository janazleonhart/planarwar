//worldcore/mud/commands/progression/questsCommand.ts

import { renderQuestLog } from "../../MudProgression";
import { turnInQuest } from "../../../quests/turnInQuest"

export async function handleQuestsCommand(_ctx: any, char: any): Promise<string> {
  return renderQuestLog(char);
}

export async function handleQuestCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[] }
): Promise<string> {
  const sub = (input.parts[1] || "").toLowerCase();

  if (!sub || sub === "log" || sub === "list") {
    return renderQuestLog(char);
  }

  if (sub === "turnin" || sub === "turn-in" || sub === "complete") {
    const target = input.parts.slice(2).join(" ");
    if (!target) return "Usage: quest turnin <id or name>";
    return turnInQuest(ctx, char, target);
  }

  return "Usage: quest [log|turnin <id or name>]";
}
