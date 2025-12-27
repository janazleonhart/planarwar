//worldcore/interaction/interactOps.ts

import { findNpcTargetByName } from "../targeting/targetFinders";

export type InteractContext = {
  session: { roomId?: string | null };
  entities?: any;
};

export type InteractInput = {
  roomIdFallback: string; // char.shardId fallback
  what: string;
};

export function interactInRoom(
  ctx: InteractContext,
  char: any,
  input: InteractInput,
  opts?: { renderQuestLog?: (char: any) => string }
): { ok: true; text: string } | { ok: false; reason: string } {
  const what = input.what.trim();
  if (!what) return { ok: false, reason: "Usage: interact <thing>" };
  if (!ctx.entities) return { ok: false, reason: "You can't see anything clearly here." };

  const roomId = ctx.session.roomId ?? input.roomIdFallback;

  const npcEnt = findNpcTargetByName(ctx as any, roomId, what);
  if (!npcEnt) return { ok: false, reason: `You don't see '${what}' here to interact with.` };

  let line = `You interact with ${npcEnt.name}.`;

  const lowerName = String(npcEnt.name ?? "").toLowerCase();
  if (lowerName.includes("rat")) {
    line += " It chitters and eyes your boots suspiciously.";
  } else if (lowerName.includes("ore") || lowerName.includes("vein")) {
    line += " The rock feels cold and solid under your hand.";
    line += " You could probably 'harvest ore' here.";
  }

  // Optional quest hinting (portable hook)
  if (opts?.renderQuestLog) {
    const questLog = opts.renderQuestLog(char);
    if (questLog.includes("Rat Culling") || questLog.includes("Ore Sampling")) {
      line +=
        " They mention local problems with rats and ore sampling. Check your quests with 'quests' or 'quest log'.";
    }
  }

  return { ok: true, text: line };
}
