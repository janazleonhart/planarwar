// worldcore/quests/QuestTurninPolicy.ts
//
// Shared helpers for quest turn-in policy enforcement + hint text.
//
// v0.2 goals:
// - Keep the rules consistent between:
//    - quest log READY/eligible-here rendering
//    - quest details turn-in hints
//    - actual turn-in enforcement (turnInQuest / handin / talk handin)
// - Provide actionable denial messaging (what to do next).

import type { CharacterState } from "../characters/CharacterTypes";
import type { QuestDefinition } from "./QuestTypes";
import { getQuestContextRoomId, getTownContextForTurnin } from "./TownQuestBoard";

export type TurninPolicy = "anywhere" | "board" | "npc";

export type TurninEnforceOk = { ok: true };
export type TurninEnforceDenied = { ok: false; message: string };
export type TurninEnforceResult = TurninEnforceOk | TurninEnforceDenied;

export function normalizeTurninPolicy(raw: unknown): TurninPolicy {
  const p = String(raw ?? "anywhere").trim().toLowerCase();
  if (p === "board") return "board";
  if (p === "npc") return "npc";
  return "anywhere";
}

function formatNpcTurninGuide(npcId: string, questId: string): string {
  // Keep these consistent with the talk/handin UX.
  return `Go to ${npcId}, then run: handin ${npcId} ${questId}  (or: talk ${npcId} handin ${questId})`;
}

function formatBoardTurninGuide(requiredBoard: string | null, questId: string): string {
  if (requiredBoard) {
    return `Return to the quest board in ${requiredBoard}, then: quest board  →  quest turnin ${questId}`;
  }
  return `Return to a town quest board, then: quest board  →  quest turnin ${questId}`;
}

/**
 * Returns a hint string when the quest cannot be turned in from the current context.
 * Returns null when no hint is needed (eligible here).
 *
 * This is used by quest log READY rendering and quest details.
 */
export function computeTurninHint(
  ctx: any,
  char: CharacterState,
  quest: QuestDefinition,
  entry: any
): string | null {
  const policy = normalizeTurninPolicy((quest as any).turninPolicy);

  if (policy === "anywhere") return null;

  if (policy === "npc") {
    const npcId = String((quest as any).turninNpcId ?? "").trim();
    if (!npcId) return "Turn-in: (quest misconfigured; missing turninNpcId)";

    // Without ctx, we can still provide static guidance.
    if (!ctx) return formatNpcTurninGuide(npcId, quest.id);

    const roomId = getQuestContextRoomId(ctx, char);
    if (!roomId) return formatNpcTurninGuide(npcId, quest.id);

    const ents =
      ctx?.entities && typeof ctx.entities.getEntitiesInRoom === "function"
        ? (ctx.entities.getEntitiesInRoom(roomId) as any[])
        : [];

    const found = Array.isArray(ents)
      ? ents.some(
          (e) =>
            String(e?.type ?? "") === "npc" &&
            String((e as any)?.protoId ?? "").trim() === npcId
        )
      : false;

    return found ? null : formatNpcTurninGuide(npcId, quest.id);
  }

  if (policy === "board") {
    const requiredBoard = String((quest as any).turninBoardId ?? "").trim();
    const acceptedTown = String(entry?.source?.townId ?? "").trim();
    const hintTown = requiredBoard || acceptedTown || null;

    if (!ctx) return formatBoardTurninGuide(hintTown, quest.id);

    const townCtx = getTownContextForTurnin(ctx, char);
    if (!townCtx) return formatBoardTurninGuide(hintTown, quest.id);

    const townId = townCtx.townId;

    if (requiredBoard && requiredBoard !== townId) {
      return formatBoardTurninGuide(requiredBoard, quest.id);
    }

    // Generated town quests bind to their accepted town.
    if (!requiredBoard && entry?.source?.kind === "generated_town") {
      if (acceptedTown && acceptedTown !== townId) {
        return formatBoardTurninGuide(acceptedTown, quest.id);
      }
    }

    return null;
  }

  return null;
}

/**
 * Enforces turn-in policy at execution time.
 * Returns ok:true when the quest may be turned in from this context.
 */
export function enforceTurninPolicy(
  ctx: any,
  char: CharacterState,
  quest: QuestDefinition,
  entry: any,
  policyRaw?: unknown
): TurninEnforceResult {
  const policy = normalizeTurninPolicy(policyRaw ?? (quest as any).turninPolicy);

  if (policy === "anywhere") return { ok: true };

  if (policy === "npc") {
    const npcId = String((quest as any).turninNpcId ?? "").trim();
    if (!npcId) {
      return {
        ok: false,
        message:
          "[quest] Turn-in denied: quest requires NPC turn-in, but it is missing turninNpcId.",
      };
    }

    const roomId = getQuestContextRoomId(ctx, char);
    if (!roomId) {
      return {
        ok: false,
        message: `[quest] You must turn this in to ${npcId}. (Your location is unknown.) ${formatNpcTurninGuide(
          npcId,
          quest.id
        )}`,
      };
    }

    const ents =
      ctx?.entities && typeof ctx.entities.getEntitiesInRoom === "function"
        ? (ctx.entities.getEntitiesInRoom(roomId) as any[])
        : [];

    const found = Array.isArray(ents)
      ? ents.some(
          (e) =>
            String(e?.type ?? "") === "npc" &&
            String((e as any)?.protoId ?? "").trim() === npcId
        )
      : false;

    if (!found) {
      return {
        ok: false,
        message: `[quest] You must turn this in to ${npcId}. ${formatNpcTurninGuide(
          npcId,
          quest.id
        )}`,
      };
    }

    return { ok: true };
  }

  if (policy === "board") {
    const townCtx = getTownContextForTurnin(ctx, char);
    if (!townCtx) {
      return {
        ok: false,
        message:
          "[quest] You must be at a town quest board to turn this in. (Try: quest board)",
      };
    }

    const townId = townCtx.townId;
    const requiredBoard = String((quest as any).turninBoardId ?? "").trim();

    if (requiredBoard && requiredBoard !== townId) {
      const src = entry?.source;
      const acceptedTown = String(src?.townId ?? "").trim();

      // When a generated town quest is turned in elsewhere, make the binding explicit.
      // This keeps UX clear and matches the contract expectation.
      if (src?.kind === "generated_town" && acceptedTown && acceptedTown === requiredBoard) {
        return {
          ok: false,
          message: `[quest] You must return to the quest board for ${requiredBoard}. (This quest is bound to the town where you accepted it. Here: ${townId})`,
        };
      }

      return {
        ok: false,
        message: `[quest] You must return to the quest board for ${requiredBoard}. (Here: ${townId})`,
      };
    }

    // Generated town quests implicitly bind to their accepted town if not explicitly set.
    const src = entry?.source;
    if (!requiredBoard && src?.kind === "generated_town") {
      const acceptedTown = String(src.townId ?? "").trim();
      if (acceptedTown && acceptedTown !== townId) {
        return {
          ok: false,
          message: `[quest] You must return to the quest board where you accepted this quest. (Required: ${acceptedTown}, here: ${townId})`,
        };
      }
    }

    return { ok: true };
  }

  return { ok: true };
}
