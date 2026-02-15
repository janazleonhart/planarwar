//worldcore/mud/commands/progression/questsCommand.ts

import { renderQuestLog, renderQuestDetails } from "../../../quests/QuestText";
import { turnInQuest } from "../../../quests/turnInQuest";
import {
  renderTownQuestBoard,
  acceptTownQuest,
  abandonQuest,
} from "../../../quests/TownQuestBoard";

export async function handleQuestsCommand(ctx: any, char: any): Promise<string> {
  // Keep 'quests' as the log for backward compatibility.
  return renderQuestLog(char, { ctx });
}

export async function handleQuestCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[] }
): Promise<string> {
  const sub = (input.parts[1] || "").toLowerCase();

  if (!sub || sub === "log" || sub === "list" || sub === "quests" || sub === "questlog") {
    return renderQuestLog(char, { ctx });
  }

  if (sub === "ready") {
    const arg = (input.parts[2] || "").toLowerCase();
    if (arg === "here" || arg === "local") {
      return renderQuestLog(char, { filter: "ready_here", ctx });
    }
    return renderQuestLog(char, { filter: "ready", ctx });
  }

  if (sub === "readyhere" || sub === "ready_here") {
    return renderQuestLog(char, { filter: "ready_here", ctx });
  }

  // Symmetry sugar: `quest readylocal` and `quest ready_local` mirror `readyhere`.
  if (sub === "readylocal" || sub === "ready_local") {
    return renderQuestLog(char, { filter: "ready_here", ctx });
  }

  if (sub === "show" || sub === "info" || sub === "details") {
    const target = input.parts.slice(2).join(" ").trim();
    if (!target) return "Usage: quest show <#|id|name>";
    return renderQuestDetails(char, target, { ctx });
  }

  if (sub === "board" || sub === "questboard") {
    const mode = String(input.parts[2] ?? "").toLowerCase().trim();
    if (mode === "new") {
      return renderTownQuestBoard(ctx, char, { onlyNew: true });
    }
    return renderTownQuestBoard(ctx, char);
  }

  if (sub === "accept") {
    const target = input.parts.slice(2).join(" ").trim();
    if (!target) return "Usage: quest accept <#|id|name>";
    return acceptTownQuest(ctx, char, target);
  }

  if (sub === "abandon" || sub === "drop") {
    const target = input.parts.slice(2).join(" ").trim();
    if (!target) return "Usage: quest abandon <#|id|name>";
    return abandonQuest(ctx, char, target);
  }

  if (sub === "turnin" || sub === "turn-in" || sub === "complete") {
    const target = input.parts.slice(2).join(" ").trim();
    if (!target) return "Usage: quest turnin <#|id|name> (or 'list'/'ready')";

    // QoL: make 'quest turnin ready' behave like 'quest ready' (players discover it faster).
    if (target.toLowerCase() === "ready") {
      const arg = (input.parts[3] || "").toLowerCase();
      if (arg === "here" || arg === "local") {
        return renderQuestLog(char, { filter: "ready_here", ctx });
      }
      return renderQuestLog(char, { filter: "ready", ctx });
    }

    if (target.toLowerCase() === "readyhere" || target.toLowerCase() === "ready_here") {
      return renderQuestLog(char, { filter: "ready_here", ctx });
    }

    return turnInQuest(ctx, char, target);
  }

  return [
    "Usage:",
    " quest                      (shows quest log)",
    " quest ready                (shows quests ready to turn in)",
    " quest ready here|local     (shows quests ready to turn in from here)",
    " quest readyhere|readylocal (aliases of 'quest ready here')",
    " quest show <#|id|name>      (shows quest details)",
    " quest board                (shows available town quests)",
    " quest board new            (shows only newly unlocked follow-ups)",
    " quest accept <#|id|name>",
    " quest abandon <#|id|name>",
    " quest turnin list          (shows completed quests ready to turn in)",
    " quest turnin list here|local (shows completed quests ready to turn in from here)",
    " quest turnin ready         (alias of 'quest ready')",
    " quest turnin ready here|local (alias of 'quest ready here')",
    " quest turnin preview <#|id|name> (shows readiness + reward preview)",
    " quest turnin all           (shows confirm token for bulk turn-in)",
    " quest turnin all here|local (shows confirm token for bulk turn-in (eligible here))",
    " quest turnin all --preview (shows bulk eligible list, no token)",
    " quest turnin all here|local --preview (shows bulk eligible list here, no token)",
    " quest turnin all <token>   (bulk turn-in all completed quests)",
    " quest turnin all here|local <token> (bulk turn-in completed quests eligible here)",
    " quest turnin <#|id|name>   (turn in by quest-log index, id, or name)",
    " quest turnin <#|id|name> choose <#> (pick a choose-one reward option)"
  ].join("\n");
}