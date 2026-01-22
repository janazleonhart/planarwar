// worldcore/mud/commands/world/talkCommand.ts

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";
import { getNpcPrototype } from "../../../npc/NpcTypes";
import { applyProgressionEvent } from "../../../progression/ProgressionCore";
import { applyProgressionForEvent } from "../../MudProgressionHooks";
import {
  buildNearbyTargetSnapshot,
  distanceXZ,
  getEntityXZ,
  resolveNearbyHandleInRoom,
} from "../../handles/NearbyHandles";

const MAX_TALK_RADIUS = 30; // keep consistent with nearbyCommand for v1
const MAX_TALK_LIMIT = 200;

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

export async function handleTalkCommand(
  ctx: MudContext,
  char: CharacterState,
  input: { cmd: string; args: string[]; parts: string[]; world?: any }
): Promise<any> {
  const targetRaw = input.args.join(" ").trim();
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
  const { snippets } = await applyProgressionForEvent(ctx, char, "kills", proto.id);

  let line = `[talk] You speak with ${proto.name}.`;
  if (snippets.length > 0) line += " " + snippets.join(" ");
  return line;
}
