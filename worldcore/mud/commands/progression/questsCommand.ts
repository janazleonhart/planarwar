//worldcore/mud/commands/progression/questsCommand.ts

import { renderQuestLog } from "../../MudProgression";
import { turnInQuest } from "../../../quests/turnInQuest";
import {
  renderTownQuestBoard,
  acceptTownQuest,
  abandonQuest,
} from "../../../quests/TownQuestBoard";

export async function handleQuestsCommand(ctx: any, char: any): Promise<string> {
  // Keep 'quests' as the log for backward compatibility.
  return renderQuestLog(char);
}

export async function handleQuestCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[] }
): Promise<string> {
  const sub = (input.parts[1] || "").toLowerCase();

  if (!sub || sub === "log" || sub === "list" || sub === "quests" || sub === "questlog") {
    return renderQuestLog(char);
  }

  if (sub === "board" || sub === "questboard") {
    return renderTownQuestBoard(ctx, char);
  }

  if (sub === "accept") {
    const target = input.parts.slice(2).join(" ").trim();
    if (!target) return "Usage: quest accept <#|id>";
    return acceptTownQuest(ctx, char, target);
  }

  if (sub === "abandon" || sub === "drop") {
    const target = input.parts.slice(2).join(" ").trim();
    if (!target) return "Usage: quest abandon <#|id>";
    return abandonQuest(ctx, char, target);
  }

  if (sub === "turnin" || sub === "turn-in" || sub === "complete") {
    const target = input.parts.slice(2).join(" ");
    if (!target) return "Usage: quest turnin <#|id|name> (or 'list'/'ready')";
    return turnInQuest(ctx, char, target);
  }

  return [
    "Usage:",
    " quest                     (shows quest log)",
    " quest board                (shows available town quests)",
    " quest accept <#|id>",
    " quest abandon <#|id>",
    " quest turnin list          (shows completed quests ready to turn in)",
    " quest turnin ready         (alias of list)",
    " quest turnin preview <#|id|name> (shows readiness + reward preview)",
    " quest turnin all           (shows confirm token for bulk turn-in)",
    " quest turnin all <token>   (bulk turn-in all completed quests)",
    " quest turnin <#|id|name>   (turn in by quest-log index, id, or name)",
  ].join("\n");
}
