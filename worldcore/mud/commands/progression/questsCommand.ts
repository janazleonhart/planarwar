//worldcore/mud/commands/progression/questsCommand.ts

import { renderQuestLog, renderQuestDetails } from "../../../quests/QuestText";
import { turnInQuest } from "../../../quests/turnInQuest";
import {
  renderTownQuestBoard,
  renderTownQuestBoardDebugCaps,
  renderTownQuestBoardDebugTuning,
  resolveTownQuestFromBoardView,
  acceptTownQuest,
  abandonQuest,
} from "../../../quests/TownQuestBoard";

import { getStaffRole } from "../../../shared/AuthTypes";

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

  const isDevDebugAllowed = (): boolean => {
    // Most unit tests stub `ctx.session.auth.isDev`, while live sessions use `identity.flags`.
    if (ctx?.session?.auth?.isDev) return true;
    const flags = ctx?.session?.identity?.flags;
    const role = getStaffRole(flags);
    return role === "owner" || role === "dev";
  };

  // Split a selector plus optional `choose N` suffix.
  // This keeps board-scoped commands consistent with `quest turnin <id> choose <n>`.
  const splitSelectorAndChoice = (parts: string[]): { selector: string; choice: number | null } => {
    const p = parts.map((x) => String(x ?? "")).filter((s) => s.trim().length > 0);
    if (p.length === 0) return { selector: "", choice: null };

    const chooseAt = p.findIndex((w) => {
      const l = w.toLowerCase();
      return l === "choose" || l === "choice" || l === "pick";
    });

    if (chooseAt === -1) return { selector: p.join(" ").trim(), choice: null };

    const selector = p.slice(0, chooseAt).join(" ").trim();
    const n = Number(p[chooseAt + 1]);
    if (!Number.isInteger(n) || n <= 0) return { selector: p.join(" ").trim(), choice: null };
    return { selector, choice: n };
  };

  
  if (sub === "help" || sub === "?" || sub === "h") {
    return [
      "Usage:",
      " quest help                 (shows this help)",
    " quest                      (shows quest log)",
      " quest ready                (shows quests ready to turn in)",
      " quest ready here|local     (shows quests ready to turn in from here)",
      " quest show <#|id|name>      (shows quest details)",
      " quest accept <#|id|name>    (accepts a town quest by id/name, or # from the current board view)",
      " quest abandon <#|id|name>   (abandons an active quest)",
      " quest turnin ...            (see: quest turnin list/ready/preview/all)",
      "",
      "Quest board:",
      " quest board                 (shows town quest board)",
      " quest board help            (shows board filters + board-scoped actions)",
      " quest board available        (only available [ ] quests; excludes NEW follow-ups)",
      " quest board new             (only NEW unlocked follow-ups)",
      " quest board active          (only your active quests)",
      " quest board ready           (only quests ready to turn in)",
      " quest board turned|done     (only turned-in quests)",
      "",
      "Board-scoped actions (indices always match the current board view):",
      " quest board show <#|id|name>",
      " quest board accept <#|id|name>",
      " quest board preview <#|id|name>   (reward + policy preview)",
      " quest board turnin <#|id|name> (optionally: choose <#>)",
      " quest board <mode> show <#|id|name>",
      " quest board <mode> accept <#|id|name>",
      " quest board <mode> preview <#|id|name>",
      " quest board <mode> turnin <#|id|name> (optionally: choose <#>)",
    ].join("\n").trimEnd();
  }

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

  // Staff-only internal tooling: deterministic debug metadata.
  // (Do not expose this via normal player UX; it exists to help us sanity-check board rotation.)
  if (sub === "debug") {
    if (!isDevDebugAllowed()) return "[quest] Debug is staff-only.";

    const sub2 = (input.parts[2] || "").toLowerCase();
    if (!sub2 || sub2 === "help" || sub2 === "?" || sub2 === "h") {
      return [
        "Quest Debug (staff):",
        " quest debug show <#|id|name>",
        " quest debug explain <#|id|name>      (show + rotation-memory comparisons)",
        " quest debug board                 (full board + per-quest metadata)",
        " quest debug board <available|new|active|ready|turned>",
        " quest debug caps                  (shows rotation memory + keys)",
        " quest debug tuning                (shows effective generator tuning defaults)",
      ].join("\n").trimEnd();
    }

    if (sub2 === "show") {
      const target = input.parts.slice(3).join(" ").trim();
      if (!target) return "Usage: quest debug show <#|id|name>";
      return renderQuestDetails(char, target, { ctx, debug: true });
    }

    if (sub2 === "explain") {
      const target = input.parts.slice(3).join(" ").trim();
      if (!target) return "Usage: quest debug explain <#|id|name>";
      return renderQuestDetails(char, target, { ctx, debug: true, explain: true });
    }


    if (sub2 === "caps" || sub2 === "cap") {
      return renderTownQuestBoardDebugCaps(ctx, char);
    }

    if (sub2 === "tuning" || sub2 === "tunings") {
      return renderTownQuestBoardDebugTuning(ctx, char);
    }

    if (sub2 === "board") {
      const mode = (input.parts[3] || "").toLowerCase();
      const parseBoardMode = (s: string): any => {
        if (s === "new") return { onlyNew: true };
        if (s === "available" || s === "avail") return { onlyAvailable: true };
        if (s === "active") return { onlyActive: true };
        if (s === "ready") return { onlyReady: true };
        if (s === "turned" || s === "turnedin" || s === "turned_in" || s === "done") return { onlyTurned: true };
        return null;
      };
      const m = parseBoardMode(mode) ?? {};
      return renderTownQuestBoard(ctx, char, { ...m, debug: true });
    }

    return "[quest] Unknown debug command. Try: quest debug help";
  }


  if (sub === "board" || sub === "questboard") {
    const a2 = String(input.parts[2] ?? "").toLowerCase().trim();
    if (a2 === "help" || a2 === "?" || a2 === "h") {
      return [
        "Quest Board (town context):",
        " quest board                 (full board)",
        " quest board available        (only available [ ] quests; excludes NEW follow-ups)",
        " quest board new             (only NEW unlocked follow-ups)",
        " quest board active          (only your active quests)",
        " quest board ready           (only quests ready to turn in)",
        " quest board turned|done     (only turned-in quests)",
        "",
        "Board-scoped actions (indices always match the current rendered view):",
        " quest board show <#|id|name>",
        " quest board accept <#|id|name>",
        " quest board preview <#|id|name>",
        " quest board turnin <#|id|name> (optionally: choose <#>)",
        " quest board <mode> show <#|id|name>",
        " quest board <mode> accept <#|id|name>",
        " quest board <mode> preview <#|id|name>",
        " quest board <mode> turnin <#|id|name> (optionally: choose <#>)",
        "",
        "Tip: use numeric indices only within the view you are looking at.",
      ].join("\n").trimEnd();
    }



    const parseBoardMode = (s: string): any => {
      if (s === "new") return { onlyNew: true };
      if (s === "available" || s === "avail") return { onlyAvailable: true };
      if (s === "active") return { onlyActive: true };
      if (s === "ready") return { onlyReady: true };
      if (s === "turned" || s === "turnedin" || s === "turned_in" || s === "done") return { onlyTurned: true };
      return null;
    };

    const modeOpts = parseBoardMode(a2);
    const verb = String(input.parts[modeOpts ? 3 : 2] ?? "").toLowerCase().trim();
    const tail = input.parts.slice(modeOpts ? 4 : 3);
    const { selector, choice } = splitSelectorAndChoice(tail);

    // Action forms (keep these inside `quest board` so indices match the current view):
    //  - quest board accept <#|id|name>
    //  - quest board show <#|id|name>
    //  - quest board <mode> accept <#|id|name>
    //  - quest board <mode> show <#|id|name>
    if (verb === "accept") {
      if (!selector) {
        return [
          "Usage: quest board" + (modeOpts ? " " + a2 : "") + " accept <#|id|name>",
          "Tip: numeric indices here match the current board view.",
        ].join("\n");
      }
      return acceptTownQuest(ctx, char, selector, modeOpts ?? undefined);
    }

    if (verb === "turnin" || verb === "turn-in" || verb === "complete") {
      if (!selector) {
        return "Usage: quest board" + (modeOpts ? " " + a2 : "") + " turnin <#|id|name> (optionally: choose <#>)";
      }

      // Resolve indices against the current board view first.
      const resolved = resolveTownQuestFromBoardView(ctx, char, selector, modeOpts ?? undefined);
      if (!resolved) return `[quest] Unknown quest '${selector}'.`;

      const arg = choice ? `${resolved.id} choose ${choice}` : resolved.id;
      return turnInQuest(ctx, char, arg);
    }

    if (verb === "preview" || verb === "peek" || verb === "inspect") {
      if (!selector) {
        return "Usage: quest board" + (modeOpts ? " " + a2 : "") + " preview <#|id|name>";
      }

      // Resolve indices against the current board view first, then delegate to canonical preview.
      const resolved = resolveTownQuestFromBoardView(ctx, char, selector, modeOpts ?? undefined);
      if (!resolved) return `[quest] Unknown quest '${selector}'.`;

      const preview = await turnInQuest(ctx, char, `preview ${resolved.id}`);

      // UX polish: when preview is invoked from the board, show the matching board-scoped turn-in form.
      // This avoids “preview via board, then turn-in via some other selector syntax” confusion.
      const prefix = `quest board${modeOpts ? " " + a2 : ""}`;
      const tail: string[] = [];
      tail.push(`Or (same view): ${prefix} turnin ${selector}`);
      if (/Use at turn-in:.*\bchoose\s+<\#>/i.test(preview)) {
        tail.push(`Or (same view): ${prefix} turnin ${selector} choose <#>`);
      }
      return `${preview}\n${tail.join("\n")}`.trimEnd();
    }

    if (verb === "show" || verb === "info" || verb === "details") {
      if (!selector) {
        return "Usage: quest board" + (modeOpts ? " " + a2 : "") + " show <#|id|name>";
      }
      // Resolve indices against the current board view before handing off to QuestText.
      const resolved = resolveTownQuestFromBoardView(ctx, char, selector, modeOpts ?? undefined);
      return resolved ? renderQuestDetails(char, resolved.id, { ctx }) : `[quest] Unknown quest '${selector}'.`;
    }

    // View form
    if (modeOpts) return renderTownQuestBoard(ctx, char, modeOpts);
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
    " quest help                 (shows this help)",
    " quest                      (shows quest log)",
    " quest ready                (shows quests ready to turn in)",
    " quest ready here|local     (shows quests ready to turn in from here)",
    " quest readyhere|readylocal (aliases of 'quest ready here')",
    " quest show <#|id|name>      (shows quest details)",
    " quest board                (shows available town quests)",
    " quest board available       (shows only available (non-NEW) town quests)",
    " quest board new            (shows only newly unlocked follow-ups)",
    " quest board active         (shows only your active quests)",
    " quest board ready          (shows only quests ready to turn in)",
    " quest board turned|done    (shows only turned-in quests)",
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
