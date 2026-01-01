// worldcore/mud/commands/world/talkCommand.ts

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";
import { getNpcPrototype } from "../../../npc/NpcTypes";
import { applyProgressionEvent } from "../../../progression/ProgressionCore";
import { applyProgressionForEvent } from "../../MudProgressionHooks";

const MAX_TALK_RADIUS = 30; // keep consistent with nearbyCommand for v1

function normalizeHandleBase(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  return words[words.length - 1] ?? "entity";
}

function buildTalkTargets(ctx: MudContext, char: CharacterState, roomId: string) {
  const entities = (ctx.entities as any)?.getEntitiesInRoom?.(roomId) ?? [];
  const self = (ctx.entities as any)?.getEntityByOwner?.(ctx.session.id) as any;
  const selfId = self?.id;

  const originX =
    (typeof (char as any)?.posX === "number" ? (char as any).posX : undefined) ??
    (typeof self?.x === "number" ? self.x : undefined) ??
    0;
  const originZ =
    (typeof (char as any)?.posZ === "number" ? (char as any).posZ : undefined) ??
    (typeof self?.z === "number" ? self.z : undefined) ??
    0;

  const others = (entities as any[]).filter((e) => e && e.id && e.id !== selfId);

  // Same distance sorting as nearby (distance, then name, then id).
  const withDist = others
    .map((e) => {
      const dx = (e.x ?? 0) - originX;
      const dz = (e.z ?? 0) - originZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      return { e, dist };
    })
    .filter(({ dist }) => dist <= MAX_TALK_RADIUS)
    .sort((a, b) => {
      if (a.dist !== b.dist) return a.dist - b.dist;
      const an = String(a.e?.name ?? "").toLowerCase();
      const bn = String(b.e?.name ?? "").toLowerCase();
      if (an !== bn) return an.localeCompare(bn);
      return String(a.e?.id ?? "").localeCompare(String(b.e?.id ?? ""));
    });

  // Recreate the same handle numbering strategy as nearbyCommand
  const shortCounts = new Map<string, number>();

  const targets = withDist.map(({ e, dist }) => {
    const hasSpawnPoint = typeof e?.spawnPointId === "number";
    const isPlayerLike = !!e?.ownerSessionId && !hasSpawnPoint;

    let kind: string;
    if (isPlayerLike) kind = "player";
    else if (e.type === "npc" || e.type === "mob") kind = "npc";
    else kind = e.type ?? "entity";

    const name = String(e.name ?? e.id);
    const base = normalizeHandleBase(name);
    const shortKey = `${kind}:${base}`;
    const n = (shortCounts.get(shortKey) ?? 0) + 1;
    shortCounts.set(shortKey, n);

    const hint = `${base}.${n}`;
    return { e, dist, kind, name, hint };
  });

  const byIndex = targets; // 1-based externally
  const byHint = new Map<string, any[]>();
  for (const t of targets) {
    const key = t.hint.toLowerCase();
    const arr = byHint.get(key) ?? [];
    arr.push(t);
    byHint.set(key, arr);
  }

  return { self, byIndex, byHint };
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
  const targetNameRaw = input.args.join(" ").trim();
  if (!targetNameRaw) return "Usage: talk <target>";

  const selfEntity = (ctx.entities as any)?.getEntityByOwner?.(ctx.session.id) as any;
  if (!selfEntity) return "You don't have a world entity yet.";

  const roomId =
    (ctx.session as any)?.roomId ??
    selfEntity.roomId ??
    (char as any).shardId;

  // Build a target list consistent with nearby
  const { byIndex, byHint } = buildTalkTargets(ctx, char, roomId);

  if (byIndex.length === 0) {
    return `There is no '${targetNameRaw}' here to talk to.`;
  }

  let target: any | null = null;

  // Case 1: "2" => 2nd item in the nearby-ordered list (within talk radius)
  if (/^\d+$/.test(targetNameRaw)) {
    const idx = Math.max(1, parseInt(targetNameRaw, 10)) - 1;
    target = byIndex[idx]?.e ?? null;
  } else {
    const key = targetNameRaw.toLowerCase().trim();

    // Case 2: exact handle match (rat.1 / towntest00.1)
    const hinted = byHint.get(key);
    if (hinted && hinted.length > 0) {
      target = hinted[0].e;
    } else {
      // Case 3: fallback name substring match
      const want = key.replace(/[^a-z0-9 ]/g, "").trim();
      target =
        byIndex.find((t) => String(t.name).toLowerCase().includes(want))?.e ?? null;
    }
  }

  if (!target) {
    return `There is no '${targetNameRaw}' here to talk to.`;
  }

  // POI talk (town, checkpoint, etc.)
  const tType = String(target?.type ?? "");
  if (tType && tType !== "npc" && tType !== "mob") {
    if (tType === "town") {
      return renderTownMenu(ctx);
    }
    if (tType === "player") {
      return "That is another player. Use 'tell <name> <message>' to talk to them.";
    }
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
