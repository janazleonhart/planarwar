// worldcore/mud/commands/world/talkCommand.ts

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";
import crypto from "node:crypto";
import { getNpcPrototype } from "../../../npc/NpcTypes";
import { applyProgressionEvent } from "../../../progression/ProgressionCore";
import { applyProgressionForEvent } from "../../MudProgressionHooks";
import { ensureQuestState } from "../../../quests/QuestState";
import { resolveQuestDefinitionFromStateId } from "../../../quests/TownQuestBoard";
import { acceptTownQuest, abandonQuest, renderTownQuestBoard } from "../../../quests/TownQuestBoard";
import { turnInQuest } from "../../../quests/turnInQuest";
import { renderQuestLog } from "../../../quests/QuestText";
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
  // Preserve multi-word targets by finding the *last* action keyword and splitting around it.
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

    // help
    "help",
    "?",
  ]);

  let action = "";
  let actionArgs: string[] = [];
  let targetRaw = "";

  if (args.length === 0) {
    targetRaw = "";
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
  const npcToken = (targetHandle ?? targetRaw).trim();

  // ---------------------------------------------------------------------------
  // Help: talk <npc> help
  // ---------------------------------------------------------------------------

  if (normalizedAction === "help" || normalizedAction === "?") {
    lines.push("[talk] Commands:");
    lines.push(` - talk ${npcToken} quests            (view the town quest board)`);
    lines.push(` - talk ${npcToken} accept <#|id|name> (accept a quest from the board)`);
    lines.push(` - talk ${npcToken} abandon <#|id|name> (abandon a quest)`);
    lines.push(` - talk ${npcToken} questlog           (view your quest log)`);
    lines.push(` - talk ${npcToken} ready [here|local] (view quests ready to turn in)`);
    lines.push(` - talk ${npcToken} handin             (hand in if exactly one eligible)`);
    lines.push(` - talk ${npcToken} handin list|ls      (list eligible NPC hand-ins)`);
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
  // Questgiver UX: talk-driven access to the town quest board and quest accept/abandon.
  // This intentionally routes through the same TownQuestBoard helpers as the
  // existing `quest board/accept/abandon` commands to keep behavior consistent.
  // ---------------------------------------------------------------------------

  if (normalizedAction === "quests" || normalizedAction === "quest" || normalizedAction === "board") {
    lines.push(renderTownQuestBoard(ctx as any, char as any));
    lines.push("");
    lines.push(`Tip: accept via 'talk ${npcToken} accept <#|id|name>' (or: 'quest accept <#|id|name>').`);
    lines.push(`Tip: abandon via 'talk ${npcToken} abandon <#|id|name>' (or: 'quest abandon <#|id|name>').`);
    return lines.join("\n").trimEnd();
  }

  // ---------------------------------------------------------------------------
  // Quest log shortcuts, routed through the same QuestText renderer as `quest`.
  // ---------------------------------------------------------------------------

  if (normalizedAction === "questlog" || normalizedAction === "log") {
    lines.push(renderQuestLog(char as any, { ctx }));
    return lines.join("\n").trimEnd();
  }

  if (normalizedAction === "ready") {
    const mode = String(actionArgs[0] ?? "").toLowerCase().trim();
    const filter = mode === "here" || mode === "local" ? "ready_here" : "ready";
    lines.push(renderQuestLog(char as any, { ctx, filter } as any));
    return lines.join("\n").trimEnd();
  }

  if (normalizedAction === "accept") {
    const selector = actionArgs.join(" ").trim();
    if (!selector) return `Usage: talk ${npcToken} accept <#|id|name>`;
    const msg = await acceptTownQuest(ctx as any, char as any, selector);
    lines.push(msg);
    return lines.join("\n").trimEnd();
  }

  if (normalizedAction === "abandon" || normalizedAction === "drop") {
    const selector = actionArgs.join(" ").trim();
    if (!selector) return `Usage: talk ${npcToken} abandon <#|id|name>`;
    const msg = await abandonQuest(ctx as any, char as any, selector);
    lines.push(msg);
    return lines.join("\n").trimEnd();
  }

  if (eligible.length > 0) {
    const wantsHandinAction = !!action;
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
      if (/^\d+$/.test(selector)) {
        const idx = Math.max(1, parseInt(selector, 10)) - 1;
        const hit = eligible[idx];
        if (!hit) {
          return `[quest] Invalid hand-in selection #${selector}. (Try: talk ${npcToken} handin)`;
        }
        return await turnInQuest(ctx as any, (ctx as any).session?.character ?? (char as any), hit.id);
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