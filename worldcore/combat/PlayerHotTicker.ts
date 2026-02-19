// worldcore/combat/PlayerHotTicker.ts

import type { EntityManager } from "../core/EntityManager";
import type { SessionManager } from "../core/SessionManager";
import type { NpcManager } from "../npc/NpcManager";
import { getActiveStatusEffects, tickStatusEffectsAndApplyHots } from "./StatusEffects";
import { formatWorldSpellHotTickLine } from "./CombatLog";

/**
 * Tick HOTs on all connected player characters.
 *
 * NOTE: Status effects live on CharacterState (session.character). Entity HP lives on the player Entity.
 * This helper is deliberately small so TickEngine can call it without owning combat logic.
 */
export function tickAllPlayerHots(
  entities: EntityManager,
  sessions: SessionManager,
  now: number,
  npcs?: NpcManager,
): void {
  const sessIter: any[] = (() => {
    const s: any = sessions as any;
    if (typeof s.getAllSessions === "function") return s.getAllSessions();
    if (typeof s.values === "function") return Array.from(s.values());
    return [];
  })();

  for (const sess of sessIter) {
    const char = (sess as any)?.character;
    if (!char) continue;

    const ent = (entities as any)?.getEntityByOwner?.((sess as any).id);
    if (!ent) continue;

    // Cache name lookup so we can attribute ticks to the originating effect.
    // (This is best-effort; if the effect disappears mid-loop, fall back to HOT.)
    const nameById = new Map<string, string>();
    const casterByEffectId = new Map<string, string>();
    try {
      const active = getActiveStatusEffects(char as any, now);
      for (const inst of active as any[]) {
        if (!inst?.id) continue;
        const nm = String(inst.name ?? inst.sourceId ?? "HOT");
        nameById.set(String(inst.id), nm);
        const applier = String((inst as any).appliedById ?? "").trim();
        if (applier) casterByEffectId.set(String(inst.id), applier);
      }
    } catch {
      // ignore
    }

    tickStatusEffectsAndApplyHots(char as any, now, (amount, meta) => {
      const heal = Math.max(1, Math.floor(Number(amount) || 0));
      if (!Number.isFinite(heal) || heal <= 0) return;

      // Apply to entity HP (clamped).
      const maxHp = typeof (ent as any).maxHp === "number" ? (ent as any).maxHp : undefined;
      const curHp = typeof (ent as any).hp === "number" ? (ent as any).hp : 0;
      const after = typeof maxHp === "number" ? Math.min(maxHp, curHp + heal) : curHp + heal;
      (ent as any).hp = after;
      const gained = after - curHp;

      // Healing threat from HOT ticks: best-effort. Only engaged NPCs in-room will care.
      try {
        if (gained > 0 && npcs && typeof (npcs as any).recordHealing === "function") {
          const rid = String((sess as any)?.roomId ?? "").trim();
          const healerId = casterByEffectId.get(String((meta as any)?.effectId)) ?? "";
          const healedId = String((ent as any)?.id ?? "").trim();
          if (rid && healerId && healedId) {
            (npcs as any).recordHealing(rid, healerId, healedId, gained, now);
          }
        }
      } catch {
        // ignore
      }


      // Optional combat message to the owner.
      try {
        if (process.env.PW_HOT_TICK_MESSAGES === "0") return;

        const spellName = nameById.get(String((meta as any)?.effectId)) ?? "HOT";
        const line = formatWorldSpellHotTickLine({
          spellName,
          targetName: "you",
          heal,
          hpAfter: after,
          maxHp,
        });

        (sessions as any).send(sess, "mud_result", { text: line });
      } catch {
        // best-effort
      }
    });
  }
}
