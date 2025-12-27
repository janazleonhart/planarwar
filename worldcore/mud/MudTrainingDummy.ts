//worldcore/mud/MudTrainingDummy.ts

import { MudContext } from "./MudContext";
import { Attributes } from "../characters/CharacterTypes"
import { markInCombat, killEntity, isDeadEntity, applySimpleDamageToPlayer } from "./MudHelperFunctions"
import { Logger } from "../utils/logger";

const log = Logger.scope("MUD");
const TRAINING_DUMMIES = new Map<string, TrainingDummyState>();
const DUMMY_AI = new Map<string, DummyAiEntry>();
const DUMMY_ATTACK_INTERVAL_MS = 3000; // 3s between dummy swings

export interface TrainingDummyState {
    roomId: string;
    hp: number;
    maxHp: number;
}

export interface DummyAiEntry {
    timer: any;          // NodeJS.Timeout, keep as any to avoid import noise
    roomId: string;
    intervalMs: number;
}
  
export function getTrainingDummyForRoom(roomId: string): TrainingDummyState {
    let dummy = TRAINING_DUMMIES.get(roomId);
    if (!dummy) {
      dummy = {
        roomId,
        hp: 200,       // simple baseline; tweak later
        maxHp: 200,
      };
      TRAINING_DUMMIES.set(roomId, dummy);
    }
    return dummy;
}
  
export function computeTrainingDummyDamage(attrs: Attributes): number {
    // Very rough: base 5 + STR + half AGI bonus.
    const strBonus = Math.max(0, attrs.str - 10);
    const agiBonus = Math.max(0, Math.floor((attrs.agi - 10) / 2));
    const base = 5;
    return Math.max(1, base + strBonus + agiBonus);
}

export function stopTrainingDummyAi(sessionId: string): void {
    const entry = DUMMY_AI.get(sessionId);
    if (!entry) return;
    clearInterval(entry.timer);
    DUMMY_AI.delete(sessionId);
}

export function startTrainingDummyAi(
  ctx: MudContext,
  sessionId: string,
  roomId: string
): void {
  // Already running for this player? Don't stack multiple timers.
  if (DUMMY_AI.has(sessionId)) return;
  if (!ctx.entities) return;

  const timer = setInterval(() => {
    if (!ctx.entities) {
      stopTrainingDummyAi(sessionId);
      return;
    }

    // Make sure the session still exists
    const sessions = ctx.sessions.getAllSessions();
    let stillHere = false;
    for (const s of sessions) {
      if (s.id === sessionId) {
        stillHere = true;
        break;
      }
    }
    if (!stillHere) {
      stopTrainingDummyAi(sessionId);
      return;
    }

    const ent = ctx.entities.getEntityByOwner(sessionId);
    if (!ent) {
      stopTrainingDummyAi(sessionId);
      return;
    }

    const e: any = ent;

    // If player left the room, dummy stops attacking.
    if (!e.roomId || e.roomId !== roomId) {
      stopTrainingDummyAi(sessionId);
      return;
    }

    // Dead? Stop AI.
    if (isDeadEntity(e)) {
      stopTrainingDummyAi(sessionId);
      return;
    }

    // Find or create the room's dummy
    const dummy = getTrainingDummyForRoom(roomId);

    // Damage: ~5% of max HP, at least 1
    const maxHp =
      typeof e.maxHp === "number" && e.maxHp > 0 ? e.maxHp : 100;
    const dmg = Math.max(1, Math.round(maxHp * 0.05));

    // Core combat path now:
    const { newHp, maxHp: finalMaxHp, killed } = applySimpleDamageToPlayer(
      ent,
      dmg
    );

    // Tag dummy as in combat too so regen pauses
    markInCombat(dummy);

    if (killed) {
      ctx.sessions.send(ctx.session, "mud_result", {
        text: `[combat] The Training Dummy hits you for ${dmg} damage. You die. (0/${finalMaxHp} HP)\n[hint] You can type 'respawn' or 'rest' to return to life.`,
      });
      stopTrainingDummyAi(sessionId);
      return;
    }

    ctx.sessions.send(ctx.session, "mud_result", {
      text: `[combat] The Training Dummy hits you for ${dmg} damage. (${newHp}/${finalMaxHp} HP)`,
    });
  }, DUMMY_ATTACK_INTERVAL_MS);

  DUMMY_AI.set(sessionId, {
    timer,
    roomId,
    intervalMs: DUMMY_ATTACK_INTERVAL_MS,
  });
}