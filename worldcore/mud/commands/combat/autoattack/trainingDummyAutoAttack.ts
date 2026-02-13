// worldcore/mud/commands/combat/autoattack/trainingDummyAutoAttack.ts

import { Logger } from "../../../../utils/logger";
import { isDeadEntity, markInCombat } from "../../../../combat/entityCombat";
import { computeEffectiveAttributes } from "../../../../characters/Stats";

import { applyProgressionEvent } from "../../../../progression/ProgressionCore";
import { applyProgressionForEvent } from "../../../MudProgressionHooks";

import type { MudContext } from "../../../MudContext";
import type { CharacterState } from "../../../../characters/CharacterTypes";

const log = Logger.scope("AutoAttack");

export interface AutoAttackEntry {
  timer: NodeJS.Timeout;
  roomId: string;
  target: string;
  intervalMs: number;
}

export interface TrainingDummyDeps {
  getTrainingDummyForRoom(roomId: string): any;
  computeTrainingDummyDamage(effective: any): number;
  startTrainingDummyAi(ctx: MudContext, sessionId: string, roomId: string): void;
}

const AUTOATTACKS = new Map<string, AutoAttackEntry>();
export const AUTOATTACK_INTERVAL_MS = 2000; // 2s swing speed for v1

function stopAutoAttackForSession(sessionId: string): void {
  const entry = AUTOATTACKS.get(sessionId);
  if (!entry) return;
  clearInterval(entry.timer);
  AUTOATTACKS.delete(sessionId);
}

function sessionStillExists(ctx: MudContext, sessionId: string): boolean {
  const sessions = ctx.sessions.getAllSessions?.() ?? [];
  for (const s of sessions) {
    if (s.id === sessionId) return true;
  }
  return false;
}

function resolveTargetProtoId(ctx: MudContext, targetEntityId: string, fallbackName: string): string {
  try {
    const st = ctx.npcs?.getNpcStateByEntityId?.(targetEntityId);
    const proto = (st as any)?.protoId;
    if (proto && typeof proto === "string") return proto;
  } catch {
    // ignore
  }
  return fallbackName;
}

async function recordSyntheticKill(ctx: MudContext, char: CharacterState, targetProtoId: string): Promise<string[]> {
  // 1) increment progression counters (kills)
  applyProgressionEvent(char, { kind: "kill", targetProtoId });

  // 2) react: tasks/titles/quests/rewards + patch progression
  try {
    const { snippets } = await applyProgressionForEvent(ctx, char, "kills", targetProtoId);
    return snippets ?? [];
  } catch (err) {
    // Never let progression crash combat.
    // eslint-disable-next-line no-console
    console.warn("applyProgressionForEvent (synthetic kill) failed", {
      err,
      charId: char.id,
      protoId: targetProtoId,
    });
    return [];
  }
}

export function startTrainingDummyAutoAttack(ctx: MudContext, char: CharacterState, deps: TrainingDummyDeps): string {
  const sessionId = ctx.session.id;

  if (!ctx.entities) return "Combat is not available here (no entity manager).";

  const selfEnt = ctx.entities.getEntityByOwner(sessionId);
  if (!selfEnt || !selfEnt.roomId) return "You are nowhere and cannot autoattack.";

  const roomId = selfEnt.roomId;

  stopAutoAttackForSession(sessionId);

  const intervalMs = AUTOATTACK_INTERVAL_MS;

  const timer = setInterval(async () => {
    if (!sessionStillExists(ctx, sessionId)) {
      stopAutoAttackForSession(sessionId);
      return;
    }

    if (!ctx.entities) return;

    const ent = ctx.entities.getEntityByOwner(sessionId);
    if (!ent || ent.roomId !== roomId) return;

    if (isDeadEntity(ent)) {
      stopAutoAttackForSession(sessionId);
      ctx.sessions.send(ctx.session, "mud_result", {
        text: "[combat] You are dead; autoattack stops.",
        event: "death",
      });
      return;
    }

    // Find a real Training Dummy NPC in the room; if missing, stop.
    const roomEntities = ctx.entities.getEntitiesInRoom?.(roomId) ?? [];
    const dummyNpc: any =
      roomEntities.find((e: any) => {
        const st = ctx.npcs?.getNpcStateByEntityId?.(e?.id);
        const proto = (st as any)?.protoId;
        return proto === "training_dummy" || proto === "training_dummy_big";
      }) ?? null;

    if (!dummyNpc) {
      stopAutoAttackForSession(sessionId);
      ctx.sessions.send(ctx.session, "mud_result", {
        text: "Autoattack stopped (no Training Dummy here).",
      });
      return;
    }

    const targetProtoId = resolveTargetProtoId(ctx, dummyNpc.id, dummyNpc.name ?? "training_dummy");

    // Cosmetic dummy HP pool
    const dummy = deps.getTrainingDummyForRoom(roomId);
    const effective = computeEffectiveAttributes(char, (ctx as any).items);
    const dmg = deps.computeTrainingDummyDamage(effective);

    dummy.hp = Math.max(0, dummy.hp - dmg);

    markInCombat(ent);
    markInCombat(dummy);

    let line: string;
    const snippets: string[] = [];

    if (dummy.hp > 0) {
      line = `[combat] (auto) You hit the Training Dummy for ${dmg} damage. (${dummy.hp}/${dummy.maxHp} HP)`;
    } else {
      // Training dummy doesn't actually die; treat "downed" as a synthetic kill for progression/quests.
      snippets.push(...(await recordSyntheticKill(ctx, char, targetProtoId)));

      line =
        `[combat] (auto) You obliterate the Training Dummy for ${dmg} damage! ` +
        `(0/${dummy.maxHp} HP – it quickly knits itself back together.)`;

      dummy.hp = dummy.maxHp;
    }

    const extra = snippets.length > 0 ? " " + snippets.join(" ") : "";
    ctx.sessions.send(ctx.session, "mud_result", { text: line + extra });
  }, intervalMs);

  AUTOATTACKS.set(sessionId, { timer, roomId, target: "training_dummy", intervalMs });

  try {
    deps.startTrainingDummyAi(ctx, sessionId, roomId);
  } catch (err) {
    log.warn("startTrainingDummyAi failed", { err: String(err), sessionId, roomId });
  }

  return "Autoattack enabled on the Training Dummy.";
}

export function stopAutoAttack(ctx: MudContext): string {
  const sessionId = ctx.session.id;
  const entry = AUTOATTACKS.get(sessionId);
  if (!entry) return "Autoattack is already off.";
  stopAutoAttackForSession(sessionId);
  return "Autoattack disabled.";
}
