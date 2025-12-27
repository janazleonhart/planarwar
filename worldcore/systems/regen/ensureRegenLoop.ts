// worldcore/systems/regen/ensureRegenLoop.ts

import type { Entity } from "../../shared/Entity";
import { isDeadEntity } from "../../combat/entityCombat";

const REGEN_TICK_MS = 5_000; // regen pulse every 5s
const REGEN_HP_PER_TICK = 2; // 2 HP per pulse (tunable later)
let regenLoopStarted = false;

export type RegenContext = {
  sessions: { getAllSessions(): Iterable<{ id: string }> };
  entities?: { getEntityByOwner(ownerId: string): Entity | null | undefined };
};

/**
 * Global regen loop – started once on first command (for now).
 * Walks sessions -> entity and restores HP if:
 *  - has hp/maxHp
 *  - not dead
 *  - out of combat
 */
export function ensureRegenLoop(ctx: RegenContext): void {
  if (regenLoopStarted) return;
  regenLoopStarted = true;

  setInterval(() => {
    const entities = ctx.entities;
    if (!entities) return;

    const now = Date.now();
    const sessions = ctx.sessions.getAllSessions();

    for (const s of sessions) {
      const ent = entities.getEntityByOwner(s.id);
      if (!ent) continue;

      const e: any = ent;

      const maxHp = typeof e.maxHp === "number" && e.maxHp > 0 ? e.maxHp : 0;
      if (maxHp <= 0) continue;

      if (isDeadEntity(e)) continue;

      const hp = typeof e.hp === "number" ? e.hp : maxHp; // if missing, treat as full
      if (hp >= maxHp) continue;

      const inCombatUntil = typeof e.inCombatUntil === "number" ? e.inCombatUntil : 0;
      if (inCombatUntil > now) continue;

      e.hp = Math.min(maxHp, hp + REGEN_HP_PER_TICK);
    }
  }, REGEN_TICK_MS);
}
