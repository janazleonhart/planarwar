// worldcore/mud/commands/world/talkCommand.ts

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";
import crypto from "node:crypto";
import { getNpcPrototype } from "../../../npc/NpcTypes";
import { applyProgressionEvent } from "../../../progression/ProgressionCore";
import { applyProgressionForEvent } from "../../MudProgressionHooks";
import { ensureQuestState } from "../../../quests/QuestState";
import { resolveQuestDefinitionFromStateId } from "../../../quests/TownQuestBoard";
import { acceptTownQuest, abandonQuest, renderTownQuestBoard, resolveTownQuestFromBoardView } from "../../../quests/TownQuestBoard";
import { turnInQuest } from "../../../quests/turnInQuest";
import { renderQuestDetails, renderQuestLog } from "../../../quests/QuestText";
import {
  buildNearbyTargetSnapshot,
  distanceXZ,
  getEntityXZ,
  resolveNearbyHandleInRoom,
} from "../../handles/NearbyHandles";

const MAX_TALK_RADIUS = 30; // keep consistent with nearbyCommand for v1
const MAX_TALK_LIMIT = 200;

function computeHandinAllToken(char: CharacterState, npcProtoId: string, questIds: string[]): string {
  const seed = [
    String((char as any).id),
    String((char as any).userId ?? ""),
    String(npcProtoId ?? ""),
    ...questIds,
    "talk_handin_all_v1",
  ].join("|");

  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

function getEntitiesInRoom(ctx: MudContext, roomId: string): any[] {
  const em: any = ctx.entities as any;
  const list = em?.getEntitiesInRoom?.(roomId);
  return Array.isArray(list) ? list : [];
}

function getSelfEntity(ctx: MudContext): any | null {
  const em: any = ctx.entities as any;
  return (em?.getEntityByOwner?.(ctx.session.id) as any) ?? null;
}

function getRoomId(ctx: MudContext, selfEntity: any, char: CharacterState): string {
  return (
    (ctx.session as any)?.roomId ??
    selfEntity?.roomId ??
    (char as any)?.roomId ??
    (char as any)?.shardId
  );
}

function getOriginXZ(char: CharacterState, selfEntity: any): { x: number; z: number } {
  const cx = (char as any)?.posX;
  const cz = (char as any)?.posZ;
  if (typeof cx === "number" && typeof cz === "number") return { x: cx, z: cz };
  return getEntityXZ(selfEntity);
}

function isPlayerLikeEntity(e: any): boolean {
  const hasSpawnPoint = typeof e?.spawnPointId === "number";
  return !!e?.ownerSessionId && !hasSpawnPoint;
}

function resolveByHandleDuck(ctx: MudContext, roomId: string, handle: string): any | null {
  const em: any = ctx.entities as any;
  if (!em) return null;

  try {
    if (typeof em.resolveInRoomByHandle === "function") {
      const hit = em.resolveInRoomByHandle(roomId, handle);
      if (hit) return hit;
    }
  } catch {}

  try {
    if (typeof em.resolveHandleInRoom === "function") {
      const hit = em.resolveHandleInRoom(roomId, handle);
      if (hit) return hit;
    }
  } catch {}

  try {
    if (typeof em.resolveHandle === "function") {
      const hit = em.resolveHandle(handle);
      if (hit) return hit;
    }
  } catch {}

  return null;
}

function renderTownMenu(ctx: MudContext): string {
  // Keep it simple for v1: show commands that exist today.
  // Later: this becomes a real Town UI routed through faction control.
  const lines: string[] = [];
  lines.push("[town] Town Services:");
  lines.push(" - bank");
  lines.push(" - gbank");
  lines.push(" - vendor (or: buy / sell)");
  lines.push(" - ah (auction house)");
  lines.push(" - mail");
  lines.push("Tip: services may require being inside a town once PW_SERVICE_GATES=1 is enabled.");
  return lines.join("\n");
}

function listEligibleNpcTurnins(
  char: CharacterState,
  npcProtoId: string
): { id: string; name: string }[] {
  const qs = ensureQuestState(char);
  const ids = Object.keys(qs).sort();

  const completed = ids.filter((id) => qs[id]?.state === "completed");
  const out: { id: string; name: string }[] = [];

  for (const id of completed) {
    const entry = qs[id];
    const q = resolveQuestDefinitionFromStateId(id, entry);
    if (!q) continue;

    const policy = String((q as any).turninPolicy ?? "anywhere").trim();
    if (policy !== "npc") continue;

    const requiredNpc = String((q as any).turninNpcId ?? "").trim();
    if (!requiredNpc || requiredNpc !== npcProtoId) continue;

    out.push({ id: q.id, name: q.name ?? q.id });
  }

  return out;
}

export async function handleTalkCommand(
  ctx: MudContext,
  char: CharacterState,
  input: { cmd: string; args: string[]; parts: string[]; world?: any }
): Promise<any> {
  // Support:
  //  - talk <target>
  //  - talk <target> handin
  //  - talk <target> handin <#|id|name>
  //  - talk <target> handin all [token]
  //  - talk <target> quests|board
  //  - talk <target> accept <#|id|name>
  //  - talk <target> abandon <#|id|name>
  // Preserve multi-word targets while still supporting sub-modes like:
  //   talk <npc> quests ready
  // We treat quests/quest/board as the primary action if present,
  // and pass any subsequent tokens (including "ready") as action args.
  const args = Array.isArray(input.args) ? input.args : [];
  const actionKeywords = new Set([
    // hand-in actions
    "handin",
    "hand-in",
    "turnin",
    "turn-in",
    "complete",
    "finish",
    "submit",

    // questgiver-ish actions
    "quests",
    "quest",
    "board",
    "questlog",
    "log",
    "ready",
    "accept",
    "abandon",
    "drop",

    // quest info
    "show",
    "info",
    "details",

    // help
    "help",
    "?",
  ]);

  const preferredPrimaryActions = new Set(["quests", "quest", "board"]);

  let action = "";
  let actionArgs: string[] = [];
  let targetRaw = "";

  if (args.length === 0) {
    targetRaw = "";
  } else {
    // If the user is using the quest-board subcommands, treat that keyword as the
    // action even if later tokens are also action keywords (e.g. 'ready').
    let primaryIdx = -1;
    for (let i = 0; i < args.length; i++) {
      const tok = String(args[i] ?? "").trim().toLowerCase();
      if (preferredPrimaryActions.has(tok)) {
        primaryIdx = i;
        action = tok;
        break;
      }
    }

    if (primaryIdx >= 0) {
      targetRaw = args.slice(0, primaryIdx).join(" ").trim();
      actionArgs = args.slice(primaryIdx + 1);
    } else {
      let actionIdx = -1;
      for (let i = args.length - 1; i >= 0; i--) {
        const tok = String(args[i] ?? "").trim().toLowerCase();
        if (actionKeywords.has(tok)) {
          actionIdx = i;
          action = tok;
          break;
        }
      }

      if (actionIdx >= 0) {
        targetRaw = args.slice(0, actionIdx).join(" ").trim();
        actionArgs = args.slice(actionIdx + 1);
      } else {
        targetRaw = args.join(" ").trim();
      }
    }
  }

  if (!targetRaw) return "Usage: talk <target>";

  const selfEntity = getSelfEntity(ctx);
  if (!selfEntity) return "You don't have a world entity yet.";

  const roomId = getRoomId(ctx, selfEntity, char);
  const entities = getEntitiesInRoom(ctx, roomId);

  const { x: originX, z: originZ } = getOriginXZ(char, selfEntity);

  // Build targets consistent with nearby ordering/handles.
  const snapshot = buildNearbyTargetSnapshot({
    entities,
    viewerSessionId: String(ctx.session.id),
    originX,
    originZ,
    radius: MAX_TALK_RADIUS,
    excludeEntityId: String(selfEntity.id),
    limit: MAX_TALK_LIMIT,
  });

  if (snapshot.length === 0) {
    return `There is no '${targetRaw}' here to talk to.`;
  }

  let target: any | null = null;

  // Case 1: "2" => 2nd item in nearby-ordered snapshot (within talk radius)
  if (/^\d+$/.test(targetRaw)) {
    const idx = Math.max(1, parseInt(targetRaw, 10)) - 1;
    target = snapshot[idx]?.e ?? null;
  } else {
    const token = targetRaw.trim();

    // Case 2: nearby handle match ("rat.1", "guard.2", etc.)
    const viaNearby = resolveNearbyHandleInRoom({
      entities,
      viewerSessionId: String(ctx.session.id),
      originX,
      originZ,
      radius: MAX_TALK_RADIUS,
      excludeEntityId: String(selfEntity.id),
      limit: MAX_TALK_LIMIT,
      handleRaw: token,
    });
    if (viaNearby) {
      target = viaNearby.entity;
    } else {
      // Case 3: exact entity id match (if you happen to know it)
      target = entities.find((e: any) => String(e?.id ?? "") === token) ?? null;

      // Case 4: try EntityManager handle resolution (still enforce talk radius)
      if (!target && token.includes(".")) {
        const maybe = resolveByHandleDuck(ctx, roomId, token);
        if (maybe) {
          const { x: tx, z: tz } = getEntityXZ(maybe);
          const dist = distanceXZ(tx, tz, originX, originZ);
          if (dist <= MAX_TALK_RADIUS) target = maybe;
        }
      }

      // Case 5: fallback name substring match (sanitized)
      if (!target) {
        const want = token.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
        if (want) {
          target =
            snapshot.find((t) => String(t.baseName ?? "").toLowerCase().includes(want))?.e ??
            snapshot.find((t) => String(t.e?.name ?? "").toLowerCase().includes(want))?.e ??
            null;
        }
      }
    }
  }

  if (!target) {
    return `There is no '${targetRaw}' here to talk to.`;
  }

  // POI talk (town, checkpoint, etc.)
  const tType = String(target?.type ?? "");

  if (isPlayerLikeEntity(target)) {
    return "That is another player. Use 'tell <name> <message>' to talk to them.";
  }

  if (tType && tType !== "npc" && tType !== "mob") {
    if (tType === "town") return renderTownMenu(ctx);
    return "You can't talk to that. (Try 'interact' or 'use' if it’s an object.)";
  }

  // NPC talk (existing behavior)
  const npcState = (ctx.npcs as any)?.getNpcStateByEntityId?.(target.id);
  if (!npcState) return "You can't talk to that.";

  const proto = getNpcPrototype(npcState.protoId);
  if (!proto) return "You can't talk to that.";

  // 1) progression event
  applyProgressionEvent(char, { kind: "talk_to", npcId: proto.id });

  // 2) tasks/quests/titles + DB patch
  // NOTE: this isn't a kill/harvest, but we still want the shared progression reactions
  // (quests, tasks, titles, rewards) + persistence.
  const { snippets } = await applyProgressionForEvent(ctx, char, "talk_to", proto.id);

  const eligible = listEligibleNpcTurnins(char, proto.id);
  const targetHandle = snapshot.find((s) => String(s.e?.id ?? "") === String(target?.id ?? ""))?.handle;

  const lines: string[] = [];
  let base = `[talk] You speak with ${proto.name}.`;
  if (snippets.length > 0) base += " " + snippets.join(" ");
  lines.push(base);

  const normalizedAction = String(action ?? "").toLowerCase();
  const handinAliases = new Set([
    "handin",
    "hand-in",
    "turnin",
    "turn-in",
    "complete",
    "finish",
    "submit",
  ]);
  const canonicalAction = handinAliases.has(normalizedAction) ? "handin" : normalizedAction;
  const npcToken = (targetHandle ?? targetRaw).trim();

  // ---------------------------------------------------------------------------
  // Help: talk <npc> help
  // ---------------------------------------------------------------------------

  if (canonicalAction === "help" || canonicalAction === "?") {
    lines.push("[talk] Commands:");
    lines.push(` - talk ${npcToken} quests            (view the town quest board)`);
    lines.push(` - talk ${npcToken} quests available  (view only available (non-NEW) quests)`);
    lines.push(` - talk ${npcToken} quests new        (view only NEW unlocked follow-ups)`);
    lines.push(` - talk ${npcToken} quests active     (view only your active quests)`);
    lines.push(` - talk ${npcToken} quests ready      (view only quests ready to turn in)`);
    lines.push(` - talk ${npcToken} accept <#|id|name> (accept a quest from the board)`);
    lines.push(` - talk ${npcToken} abandon <#|id|name> (abandon a quest)`);
    lines.push(` - talk ${npcToken} show <#|id|name>   (show quest details)`);
    lines.push(` - talk ${npcToken} questlog           (view your quest log)`);
    lines.push(` - talk ${npcToken} ready [here|local] (view quests ready to turn in)`);
    lines.push(` - talk ${npcToken} handin|turnin      (hand in if exactly one eligible)`);
    lines.push(` - talk ${npcToken} handin list|ls      (list eligible NPC hand-ins)`);
    lines.push(` - talk ${npcToken} handin preview [#|id|name] (preview a turn-in without committing)`);
    lines.push(` - talk ${npcToken} handin <#|id|name>  (hand in a specific quest)`);
    lines.push(` - talk ${npcToken} handin all [token]  (hand in all, token-gated)`);
    lines.push(`Tip: the standalone 'handin ${npcToken} ...' command also works.`);
    return lines.join("\n").trimEnd();
  }

  // ---------------------------------------------------------------------------
  // Questgiver hint: some NPCs act as the town "quest board" anchor. Without any
  // explicit subcommand, give a lightweight discoverability tip.
  // ---------------------------------------------------------------------------

  const protoTags = Array.isArray((proto as any)?.tags) ? ((proto as any).tags as any[]) : [];
  const tagSet = new Set(protoTags.map((t) => String(t ?? "").toLowerCase().trim()).filter(Boolean));
  const isQuestAnchor = tagSet.has("questgiver") || tagSet.has("trainer") || tagSet.has("service_trainer");

  if (!action && isQuestAnchor) {
    lines.push(`Tip: view quests via 'talk ${npcToken} quests' (or: 'quest board').`);
  }

  // ---------------------------------------------------------------------------
  // Quest details shortcut, routed through the same QuestText renderer as `quest show`.
  // ---------------------------------------------------------------------------

  if (canonicalAction === "show" || canonicalAction === "info" || canonicalAction === "details") {
    const selector = actionArgs.join(" ").trim();
    if (!selector) return `Usage: talk ${npcToken} show <#|id|name>`;
    lines.push(renderQuestDetails(char as any, selector, { ctx }));
    return lines.join("\n").trimEnd();
  }

  // ---------------------------------------------------------------------------
  // Questgiver UX: talk-driven access to the town quest board and quest accept/abandon.
  // This intentionally routes through the same TownQuestBoard helpers as the
  // existing `quest board/accept/abandon` commands to keep behavior consistent.
  // ---------------------------------------------------------------------------


  if (canonicalAction === "quests" || canonicalAction === "quest" || canonicalAction === "board") {
    const mode = String(actionArgs[0] ?? "").toLowerCase().trim();

    // Split a selector plus optional `choose N` suffix.
    // Mirrors quest command behavior so talk-scoped turn-ins can pick reward options.
    const splitSelectorAndChoice = (rawParts: string[]): { selector: string; choice: number | null } => {
      const p = rawParts.map((x) => String(x ?? "")).filter((s) => s.trim().length > 0);
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

    const parseBoardMode = (s: string): any => {
      if (s === "new") return { onlyNew: true };
      if (s === "available" || s === "avail") return { onlyAvailable: true };
      if (s === "active") return { onlyActive: true };
      if (s === "ready") return { onlyReady: true };
      if (s === "turned" || s === "turnedin" || s === "turned_in" || s === "done") return { onlyTurned: true };
      return null;
    };

    const modeOpts = parseBoardMode(mode);
    const verb = String(actionArgs[modeOpts ? 1 : 0] ?? "").toLowerCase().trim();
    const tail = actionArgs.slice(modeOpts ? 2 : 1);
    const { selector, choice } = splitSelectorAndChoice(tail);

    if (mode === "help" || mode === "?" || mode === "h" || verb === "help" || verb === "?" || verb === "h") {
      const prefix = `talk ${npcToken} quests`;
      lines.push("[talk] Quest board commands:");
      lines.push(` - ${prefix}                 (view the town quest board)`);
      lines.push(` - ${prefix} help            (this help)`);
      lines.push(` - ${prefix} available        (only available [ ] quests; excludes NEW follow-ups)`);
      lines.push(` - ${prefix} new             (only NEW unlocked follow-ups)`);
      lines.push(` - ${prefix} active          (only your active quests)`);
      lines.push(` - ${prefix} ready           (only quests ready to turn in)`);
      lines.push(` - ${prefix} turned|done     (only turned-in quests)`);
      lines.push("");
      lines.push("Board-scoped actions (indices always match the current rendered view):");
      lines.push(` - ${prefix} show <#|id|name>`);
      lines.push(` - ${prefix} accept <#|id|name>`);
      lines.push(` - ${prefix} preview <#|id|name>`);
      lines.push(` - ${prefix} turnin <#|id|name> (optionally: choose <#>)`);
      lines.push(` - ${prefix} <mode> show <#|id|name>`);
      lines.push(` - ${prefix} <mode> accept <#|id|name>`);
      lines.push(` - ${prefix} <mode> preview <#|id|name>`);
      lines.push(` - ${prefix} <mode> turnin <#|id|name> (optionally: choose <#>)`);
      return lines.join("\n").trimEnd();
    }



    // Action forms (so indices match the current rendered view):
    //  - talk <npc> quests show <#|id|name>
    //  - talk <npc> quests accept <#|id|name>
    //  - talk <npc> quests <mode> show <#|id|name>
    //  - talk <npc> quests <mode> accept <#|id|name>
    if (verb === "accept") {
      if (!selector) {
        lines.push(renderTownQuestBoard(ctx as any, char as any, modeOpts ?? undefined));
        lines.push("");
        lines.push(`Usage: talk ${npcToken} quests${modeOpts ? " " + mode : ""} accept <#|id|name>`);
        return lines.join("\n").trimEnd();
      }
      const msg = await acceptTownQuest(ctx as any, char as any, selector, modeOpts ?? undefined);
      lines.push(msg);
      return lines.join("\n").trimEnd();
    }

    if (verb === "show" || verb === "info" || verb === "details") {
      if (!selector) {
        lines.push(`Usage: talk ${npcToken} quests${modeOpts ? " " + mode : ""} show <#|id|name>`);
        return lines.join("\n").trimEnd();
      }
      const q = resolveTownQuestFromBoardView(ctx as any, char as any, selector, modeOpts ?? undefined);
      lines.push(q ? renderQuestDetails(char as any, q.id, { ctx }) : `[quest] Unknown quest '${selector}'.`);
      return lines.join("\n").trimEnd();
    }

    if (verb === "preview" || verb === "peek" || verb === "inspect") {
      if (!selector) {
        lines.push(`Usage: talk ${npcToken} quests${modeOpts ? " " + mode : ""} preview <#|id|name>`);
        return lines.join("\n").trimEnd();
      }
      const q = resolveTownQuestFromBoardView(ctx as any, char as any, selector, modeOpts ?? undefined);
      lines.push(q ? await turnInQuest(ctx as any, char as any, `preview ${q.id}`) : `[quest] Unknown quest '${selector}'.`);
      return lines.join("\n").trimEnd();
    }

    if (verb === "turnin" || verb === "turn-in" || verb === "complete") {
      if (!selector) {
        lines.push(`Usage: talk ${npcToken} quests${modeOpts ? " " + mode : ""} turnin <#|id|name> (optionally: choose <#>)`);
        return lines.join("\n").trimEnd();
      }
      const q = resolveTownQuestFromBoardView(ctx as any, char as any, selector, modeOpts ?? undefined);
      if (!q) {
        lines.push(`[quest] Unknown quest '${selector}'.`);
        return lines.join("\n").trimEnd();
      }
      const arg = choice ? `${q.id} choose ${choice}` : q.id;
      lines.push(await turnInQuest(ctx as any, char as any, arg));
      return lines.join("\n").trimEnd();
    }

    // View form
    lines.push(renderTownQuestBoard(ctx as any, char as any, modeOpts ?? undefined));
    lines.push("");
    lines.push(`Tip: show details via 'talk ${npcToken} show <#|id|name>' (or: 'quest show <#|id|name>').`);
    lines.push(`Tip: preview rewards via 'talk ${npcToken} quests preview <#|id|name>' (or: 'quest turnin preview <#|id|name>').`);
    lines.push(`Tip: accept via 'talk ${npcToken} accept <#|id|name>' (or: 'quest accept <#|id|name>').`);
    lines.push(`Tip: turn in via 'talk ${npcToken} quests turnin <#|id|name>' (or: 'quest turnin <#|id|name>').`);
    lines.push(`Tip: abandon via 'talk ${npcToken} abandon <#|id|name>' (or: 'quest abandon <#|id|name>').`);
    return lines.join("\n").trimEnd();
  }

  // ---------------------------------------------------------------------------
  // Quest log shortcuts
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------

  if (canonicalAction === "questlog" || canonicalAction === "log") {
    lines.push(renderQuestLog(char as any, { ctx }));
    return lines.join("\n").trimEnd();
  }

  if (canonicalAction === "ready") {
    const mode = String(actionArgs[0] ?? "").toLowerCase().trim();
    const filter = mode === "here" || mode === "local" ? "ready_here" : "ready";
    lines.push(renderQuestLog(char as any, { ctx, filter } as any));
    return lines.join("\n").trimEnd();
  }

  if (canonicalAction === "accept") {
    const selector = actionArgs.join(" ").trim();
    if (!selector) {
      // QoL: in talk-mode, missing selector should show the board (context) instead of just barking usage.
      lines.push(renderTownQuestBoard(ctx as any, char as any));
      lines.push("");
      lines.push(`Usage: talk ${npcToken} accept <#|id|name>`);
      lines.push(`Tip: show details via 'talk ${npcToken} show <#|id|name>'`);
      return lines.join("\n").trimEnd();
    }
    const msg = await acceptTownQuest(ctx as any, char as any, selector);
    lines.push(msg);
    return lines.join("\n").trimEnd();
  }

  if (canonicalAction === "abandon" || canonicalAction === "drop") {
    const selector = actionArgs.join(" ").trim();
    if (!selector) {
      // QoL: stay in talk-mode. Show the quest log context so the player can pick a target.
      lines.push(renderQuestLog(char as any, { ctx }));
      lines.push("");
      lines.push(`Usage: talk ${npcToken} abandon <#|id|name>`);
      return lines.join("\n").trimEnd();
    }
    const msg = await abandonQuest(ctx as any, char as any, selector);
    lines.push(msg);
    return lines.join("\n").trimEnd();
  }

  if (eligible.length > 0) {
    const wantsHandinAction = canonicalAction === "handin";
    const selector = actionArgs.join(" ").trim();

    // QoL (opt-in): if the player explicitly asks to hand in while talking, and there's only
    // one eligible NPC-policy quest, perform the turn-in immediately (unless they supplied
    // a selector).
    if (wantsHandinAction && eligible.length === 1 && !selector) {
      const msg = await turnInQuest(ctx as any, (ctx as any).session?.character ?? (char as any), eligible[0].id);
      lines.push(msg);
      return lines.join("\n").trimEnd();
    }

    // Action path: talk <npc> handin <#|id|name|all>
    if (wantsHandinAction && selector) {
      const lower = selector.toLowerCase();
      // Explicit list/ls: always show the eligible list (even when only one), never turn anything in.
      if (lower === "list" || lower === "ls") {
        const lines2: string[] = [];
        if (eligible.length === 1) {
          lines2.push(`[quest] ${proto.name} can accept a quest hand-in (1):`);
        } else {
          lines2.push(`[quest] ${proto.name} can accept quest hand-ins (${eligible.length}):`);
        }
        for (let i = 0; i < eligible.length; i++) {
          lines2.push(` - ${i + 1}) ${eligible[i].name} (${eligible[i].id})`);
        }
        lines2.push(`Use: talk ${npcToken} handin <#|id|name>`);
        lines2.push(`(Or: handin ${npcToken} list)`);
        lines2.push(`Tip: talk ${npcToken} handin (auto when exactly one eligible)`);
        return lines2.join("\n").trimEnd();
      }


      // Preview (does not turn in)
      if (lower === "preview" || lower.startsWith("preview ")) {
        const parts = selector.split(/\s+/).filter(Boolean);
        const targetSel = parts.slice(1).join(" ").trim();

        const pickByFuzzy = (raw: string): { id: string; name: string } | null => {
          if (!raw) return null;

          // Exact ID match first.
          const exact = eligible.find((e) => e.id === raw);
          if (exact) return exact;

          // Numeric index into eligible list.
          if (/^\d+$/.test(raw)) {
            const idx = Math.max(1, parseInt(raw, 10)) - 1;
            return eligible[idx] ?? null;
          }

          // Fuzzy name match (unique only).
          const want = raw.toLowerCase();
          const hits = eligible.filter((e) => String(e.name ?? "").toLowerCase().includes(want));
          if (hits.length === 1) return hits[0];

          return null;
        };

        let chosen: { id: string; name: string } | null = null;

        if (!targetSel) {
          chosen = eligible.length === 1 ? eligible[0] : null;
        } else {
          chosen = pickByFuzzy(targetSel);
        }

        if (!chosen) {
          return eligible.length === 1
            ? `[quest] Preview which hand-in? (Try: talk ${npcToken} handin preview ${eligible[0].id})`
            : `[quest] Preview which hand-in? (Try: talk ${npcToken} handin list)`;
        }

        const current = (ctx as any)?.session?.character ?? char;
        const preview = await turnInQuest(ctx as any, current as any, `preview ${chosen.id}`);

        return (
          String(preview).trimEnd() +
          `\n\nTip: hand in via 'talk ${npcToken} handin <#|id|name>' (or: 'handin ${npcToken} <#|id|name>').`
        ).trimEnd();
      }

      // Bulk (confirm-token gated)
      if (lower === "all" || lower.startsWith("all ")) {
        const parts = selector.split(/\s+/).filter(Boolean);
        const providedToken = parts.slice(1).join(" ").trim();
        const ids = eligible.map((e) => e.id).sort();
        const token = computeHandinAllToken(char, proto.id, ids);

        if (!providedToken) {
          lines.push(`[quest] Hand in ALL to ${proto.name}: ${eligible.length}`);
          for (let i = 0; i < eligible.length; i++) {
            lines.push(` - ${i + 1}) ${eligible[i].name} (${eligible[i].id})`);
          }
          lines.push("\nThis action is confirm-token gated to prevent oopsies.");
          lines.push(`Confirm with: talk ${npcToken} handin all ${token}`);
          lines.push(`(Or: handin ${npcToken} all ${token})`);
          return lines.join("\n").trimEnd();
        }

        if (providedToken !== token) {
          return [
            "[quest] Hand in ALL denied: confirm token mismatch.",
            `Re-run: talk ${npcToken} handin all (to get a fresh token)`,
          ].join("\n");
        }

        const results: string[] = [];
        for (const q of eligible) {
          const current = (ctx as any)?.session?.character ?? char;
          const msg = await turnInQuest(ctx as any, current as any, q.id);
          results.push(msg);
        }

        return (`[quest] Hand in ALL complete (${eligible.length} attempted).\n` + results.join("\n")).trimEnd();
      }

      // Numeric selection (into eligible list)
      // Also supports suffixes like: `talk <npc> handin 2 choose 1`
      {
        const selParts = selector.split(/\s+/).filter(Boolean);
        const first = selParts[0] ?? "";
        if (/^\d+$/.test(first)) {
          const idx = Math.max(1, parseInt(first, 10)) - 1;
          const hit = eligible[idx];
          if (!hit) {
            return `[quest] Invalid hand-in selection #${first}. (Try: talk ${npcToken} handin)`;
          }

          const suffix = selParts.slice(1).join(" ").trim();
          const query = suffix ? `${hit.id} ${suffix}` : hit.id;
          return await turnInQuest(ctx as any, (ctx as any).session?.character ?? (char as any), query);
        }
      }

      // Exact ID match first.
      const exact = eligible.find((e) => e.id === selector);
      if (exact) {
        return await turnInQuest(ctx as any, (ctx as any).session?.character ?? (char as any), exact.id);
      }

      // Fuzzy name match (unique only).
      const want = selector.toLowerCase();
      const hits = eligible.filter((e) => String(e.name ?? "").toLowerCase().includes(want));
      if (hits.length === 1) {
        return await turnInQuest(ctx as any, (ctx as any).session?.character ?? (char as any), hits[0].id);
      }
      if (hits.length > 1) {
        const lines2: string[] = [];
        lines2.push(`[quest] Ambiguous hand-in '${selector}' (${hits.length} matches):`);
        for (let i = 0; i < hits.length; i++) lines2.push(` - ${hits[i].name} (${hits[i].id})`);
        lines2.push(`Use: talk ${npcToken} handin <#|id>`);
        return lines2.join("\n").trimEnd();
      }

      return `[quest] No eligible NPC hand-in matches '${selector}'. (Try: talk ${npcToken} handin)`;
    }

    if (eligible.length === 1) {
      lines.push(
        `[quest] ${proto.name} can accept a quest hand-in: handin ${npcToken} (${eligible[0].name})`
      );
    } else {
      lines.push(`[quest] ${proto.name} can accept quest hand-ins (${eligible.length}):`);
      for (let i = 0; i < eligible.length; i++) {
        lines.push(` - ${i + 1}) ${eligible[i].name} (${eligible[i].id})`);
      }
      lines.push(`Use: handin ${npcToken} <#|id|name> (or: handin ${npcToken} list)`);
    }
  }

  return lines.join("\n").trimEnd();
}