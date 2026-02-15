// worldcore/mud/commands/world/handinCommand.ts

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";

import crypto from "node:crypto";

import { ensureQuestState } from "../../../quests/QuestState";
import { resolveQuestDefinitionFromStateId } from "../../../quests/TownQuestBoard";
import { turnInQuest } from "../../../quests/turnInQuest";

import {
  buildNearbyTargetSnapshot,
  distanceXZ,
  getEntityXZ,
  resolveNearbyHandleInRoom,
} from "../../handles/NearbyHandles";

const MAX_HANDIN_RADIUS = 30; // match talk/nearby for v1
const MAX_HANDIN_LIMIT = 200;

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

function isNpcEntity(e: any): boolean {
  const t = String(e?.type ?? "");
  return t === "npc" || t === "mob";
}

function npcDisplayName(e: any): string {
  const name = String(e?.name ?? "").trim();
  const pid = String((e as any)?.protoId ?? "").trim();
  return name || pid || "that NPC";
}

function computeHandinAllToken(char: CharacterState, npcProtoId: string, questIds: string[]): string {
  const seed = [
    String(char.id),
    String(char.userId ?? ""),
    String(npcProtoId ?? ""),
    ...questIds,
    "handin_all_v1",
  ].join("|");

  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

function listEligibleNpcTurnins(
  char: CharacterState,
  npcProtoId: string,
): { id: string; name: string }[] {
  const qs = ensureQuestState(char);
  const ids = Object.keys(qs).sort();

  const completed = ids.filter((id) => qs[id]?.state === "completed");
  const out: { id: string; name: string }[] = [];

  // Only quests explicitly configured for NPC turn-in to *this* NPC.
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

export async function handleHandinCommand(
  ctx: MudContext,
  char: CharacterState,
  input: { cmd: string; args: string[]; parts: string[]; world?: any },
): Promise<any> {
  if (!input.args?.length) {
    return "Usage: handin <npcHandle|#> (optional: list|all|<quest #|id|name>)";
  }

  const selfEntity = getSelfEntity(ctx);
  if (!selfEntity) return "You don't have a world entity yet.";

  const roomId = getRoomId(ctx, selfEntity, char);
  const entities = getEntitiesInRoom(ctx, roomId);
  const { x: originX, z: originZ } = getOriginXZ(char, selfEntity);

  // Unlike `talk`, `handin` prioritizes handle/index resolution.
  const targetToken = String(input.args[0] ?? "").trim();
  if (!targetToken) return "Usage: handin <npcHandle|#>";

  const snapshot = buildNearbyTargetSnapshot({
    entities,
    viewerSessionId: String(ctx.session.id),
    originX,
    originZ,
    radius: MAX_HANDIN_RADIUS,
    excludeEntityId: String(selfEntity.id),
    limit: MAX_HANDIN_LIMIT,
  });

  if (snapshot.length === 0) {
    return `There is no '${targetToken}' here to hand quests to.`;
  }

  let npcEntity: any | null = null;

  // Case 1: numeric index into nearby snapshot
  if (/^\d+$/.test(targetToken)) {
    const idx = Math.max(1, parseInt(targetToken, 10)) - 1;
    npcEntity = snapshot[idx]?.e ?? null;
  } else {
    // Case 2: nearby handle match
    const viaNearby = resolveNearbyHandleInRoom({
      entities,
      viewerSessionId: String(ctx.session.id),
      originX,
      originZ,
      radius: MAX_HANDIN_RADIUS,
      excludeEntityId: String(selfEntity.id),
      limit: MAX_HANDIN_LIMIT,
      handleRaw: targetToken,
    });
    if (viaNearby) {
      npcEntity = viaNearby.entity;
    } else {
      // Case 3: exact entity id match
      npcEntity = entities.find((e: any) => String(e?.id ?? "") === targetToken) ?? null;

      // Case 4: EntityManager handle resolution (still enforce radius)
      if (!npcEntity && targetToken.includes(".")) {
        const maybe = resolveByHandleDuck(ctx, roomId, targetToken);
        if (maybe) {
          const { x: tx, z: tz } = getEntityXZ(maybe);
          const dist = distanceXZ(tx, tz, originX, originZ);
          if (dist <= MAX_HANDIN_RADIUS) npcEntity = maybe;
        }
      }
    }
  }

  if (!npcEntity || !isNpcEntity(npcEntity)) {
    return `There is no '${targetToken}' here to hand quests to.`;
  }

  const npcProtoId = String((npcEntity as any)?.protoId ?? "").trim();
  if (!npcProtoId) {
    return "That NPC has no protoId, so quests can't bind to it for NPC turn-in.";
  }

  const eligible = listEligibleNpcTurnins(char, npcProtoId);
  const display = npcDisplayName(npcEntity);

  // Remaining args choose the action.
  const rest = input.args.slice(1).join(" ").trim();
  const lower = rest.toLowerCase();

  if (!eligible.length) {
    // Still allow a direct handin by quest id/name, in case the quest is "anywhere" policy.
    if (rest) return await turnInQuest(ctx as any, char as any, rest);
    return `[quest] ${display} has nothing for you right now.`;
  }

  // List / Ready
  if (!rest || lower === "list" || lower === "ready") {
    if (eligible.length === 1 && !rest) {
      // QoL: single eligible quest -> just do it.
      return await turnInQuest(ctx as any, char as any, eligible[0].id);
    }

    const lines: string[] = [];
    lines.push(`[quest] Hand in to ${display}:`);
    for (let i = 0; i < eligible.length; i++) {
      lines.push(` - ${i + 1}) ${eligible[i].name} (${eligible[i].id})`);
    }
    lines.push("\nUse: handin <npc> <#|id|name> (or: handin <npc> all)");
    return lines.join("\n").trimEnd();
  }

  // Bulk (confirm-token gated)
  if (lower === "all" || lower.startsWith("all ")) {
    const parts = rest.split(/\s+/).filter(Boolean);
    const providedToken = parts.slice(1).join(" ").trim();
    const ids = eligible.map((e) => e.id).sort();
    const token = computeHandinAllToken(char, npcProtoId, ids);

    if (!providedToken) {
      const lines: string[] = [];
      lines.push(`[quest] Hand in ALL to ${display}: ${eligible.length}`);
      for (let i = 0; i < eligible.length; i++) {
        lines.push(` - ${i + 1}) ${eligible[i].name} (${eligible[i].id})`);
      }
      lines.push("\nThis action is confirm-token gated to prevent oopsies.");
      lines.push(`Confirm with: handin ${targetToken} all ${token}`);
      return lines.join("\n").trimEnd();
    }

    if (providedToken !== token) {
      return [
        "[quest] Hand in ALL denied: confirm token mismatch.",
        `Re-run: handin ${targetToken} all (to get a fresh token)`,
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
  // Also supports suffixes like: `handin <npc> 2 choose 1`
  {
    const selParts = rest.split(/\s+/).filter(Boolean);
    const first = selParts[0] ?? "";

    if (/^\d+$/.test(first)) {
      const idx = Math.max(1, parseInt(first, 10)) - 1;
      const hit = eligible[idx];
      if (!hit) {
        return `[quest] Invalid hand-in selection #${first}. (Use: handin ${targetToken} list)`;
      }

      // If the player typed only the number, turn it in. If they provided extra tokens (e.g. choose), forward them.
      const suffix = selParts.slice(1).join(" ").trim();
      const query = suffix ? `${hit.id} ${suffix}` : hit.id;
      return await turnInQuest(ctx as any, char as any, query);
    }
  }

  // Otherwise treat as quest id/name (turnInQuest handles fuzzy).
  // Prefer exact eligible id match when available.
  const exact = eligible.find((e) => e.id === rest);
  if (exact) return await turnInQuest(ctx as any, char as any, exact.id);

  return await turnInQuest(ctx as any, char as any, rest);
}
