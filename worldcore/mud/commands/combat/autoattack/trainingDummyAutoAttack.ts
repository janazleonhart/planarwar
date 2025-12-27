//worldcore/mud/combat/autoattack/trainingDummyAutoAttack.ts

import { Logger } from "../../../../utils/logger";
import { isDeadEntity, markInCombat } from "../../../../combat/entityCombat";
import { computeEffectiveAttributes } from "../../../../characters/Stats";

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
  // Avoid relying on ctx.sessions.values() vs getAllSessions() differences.
  const sessions = ctx.sessions.getAllSessions?.() ?? [];
  for (const s of sessions) {
    if (s.id === sessionId) return true;
  }
  return false;
}

export function startTrainingDummyAutoAttack(
  ctx: MudContext,
  char: CharacterState,
  deps: TrainingDummyDeps
): string {
  const sessionId = ctx.session.id;

  if (!ctx.entities) {
    return "Combat is not available here (no entity manager).";
  }

  const selfEnt = ctx.entities.getEntityByOwner(sessionId);
  if (!selfEnt || !selfEnt.roomId) {
    return "You are nowhere and cannot autoattack.";
  }

  const roomId = selfEnt.roomId;

  // Clear any existing autoattack for this session.
  stopAutoAttackForSession(sessionId);

  const intervalMs = AUTOATTACK_INTERVAL_MS;

  const timer = setInterval(() => {
    // If the session disappears, stop autoattack to avoid leaking.
    if (!sessionStillExists(ctx, sessionId)) {
      stopAutoAttackForSession(sessionId);
      return;
    }

    if (!ctx.entities) return;

    // Ensure room/ent still make sense.
    const ent = ctx.entities.getEntityByOwner(sessionId);
    if (!ent || ent.roomId !== roomId) return; // moved rooms; ignore this tick

    // If dead, stop autoattack and notify.
    if (isDeadEntity(ent)) {
      stopAutoAttackForSession(sessionId);

      ctx.sessions.send(ctx.session, "mud_result", {
        text: "[combat] You are dead; autoattack stops.",
        event: "death",
      });

      return;
    }

    // Attack the training dummy in this room.
    const dummy = deps.getTrainingDummyForRoom(roomId);
    const effective = computeEffectiveAttributes(char, (ctx as any).items);
    const dmg = deps.computeTrainingDummyDamage(effective);

    dummy.hp = Math.max(0, dummy.hp - dmg);

    markInCombat(ent);
    markInCombat(dummy);

    let line: string;
    if (dummy.hp > 0) {
      line =
        `[combat] (auto) You hit the Training Dummy for ${dmg} damage. ` +
        `(${dummy.hp}/${dummy.maxHp} HP)`;
    } else {
      line =
        `[combat] (auto) You obliterate the Training Dummy for ${dmg} damage! ` +
        `(0/${dummy.maxHp} HP – it quickly knits itself back together.)`;
      dummy.hp = dummy.maxHp;
    }

    ctx.sessions.send(ctx.session, "mud_result", { text: line });
  }, intervalMs);

  AUTOATTACKS.set(sessionId, {
    timer,
    roomId,
    target: "training_dummy",
    intervalMs,
  });

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
