// worldcore/mud/commands/combat/autofire/autofire.ts

import { Logger } from "../../../../utils/logger";
import { isDeadEntity, markInCombat } from "../../../../combat/entityCombat";
import { handleRangedAttackAction } from "../../../actions/MudCombatActions";

import type { MudContext } from "../../../MudContext";
import type { CharacterState } from "../../../../characters/CharacterTypes";

const log = Logger.scope("AutoFire");

export interface AutoFireEntry {
  timer: NodeJS.Timeout;
  roomId: string;
  intervalMs: number;
}

const AUTOFIRES = new Map<string, AutoFireEntry>();

function envNumber(name: string, fallback: number): number {
  const raw = String((process.env as any)?.[name] ?? "").trim();
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function getAutoFireIntervalMs(): number {
  // v1 cadence. Later: weapon speed / haste / ammo.
  return clamp(envNumber("PW_AUTOFIRE_MS", 2000), 10, 10000);
}

function stopAutoFireForSession(sessionId: string): void {
  const entry = AUTOFIRES.get(sessionId);
  if (!entry) return;
  clearInterval(entry.timer);
  AUTOFIRES.delete(sessionId);
}

function sessionStillExists(ctx: MudContext, sessionId: string): boolean {
  const sessions = (ctx as any).sessions?.getAllSessions?.() ?? [];
  for (const s of sessions) {
    if (String((s as any).id) === String(sessionId)) return true;
  }
  return false;
}

function shouldEmitAutoFireLine(line: string): boolean {
  const s = String(line ?? "");
  // Only emit lines that represent an actual shot.
  // Deny spam is handled silently for autofire.
  return s.includes("[combat]") && s.toLowerCase().includes("you shoot");
}

/**
 * Start autofire for this player's session.
 *
 * Autofire is a periodic attempt to perform a ranged attack using the
 * existing ranged verb pipeline (engaged-target fallback, range/LoS, etc.).
 *
 * - No engaged target => no-op (no spam)
 * - Out of range / no LoS => no-op (no spam)
 * - Dead => stops
 */
export function startAutoFire(ctx: MudContext, char: CharacterState): string {
  const sessionId = (ctx as any).session?.id;
  if (!sessionId) return "Autofire cannot start (no session).";

  if (!(ctx as any).entities) {
    return "Combat is not available here (no entity manager).";
  }

  const selfEnt = (ctx as any).entities.getEntityByOwner(sessionId);
  if (!selfEnt || !(selfEnt as any).roomId) {
    return "You are nowhere and cannot autofire.";
  }

  const roomId = (selfEnt as any).roomId;

  // Clear any existing autofire for this session.
  stopAutoFireForSession(sessionId);

  const intervalMs = getAutoFireIntervalMs();

  const timer = setInterval(() => {
    // If the session disappears, stop autofire to avoid leaking.
    if (!sessionStillExists(ctx, sessionId)) {
      stopAutoFireForSession(sessionId);
      return;
    }

    const entities = (ctx as any).entities;
    if (!entities) return;

    const ent = entities.getEntityByOwner(sessionId);
    if (!ent || (ent as any).roomId !== roomId) return; // moved rooms; ignore tick

    if (isDeadEntity(ent)) {
      stopAutoFireForSession(sessionId);
      try {
        (ctx as any).sessions?.send?.((ctx as any).session, "mud_result", {
          text: "[combat] You are dead; autofire stops.",
});
      } catch {
        // ignore
      }
      return;
    }

    // Invoke ranged attack with no explicit target: uses engaged target (deny-by-default).
    void (async () => {
      try {
        const line = await handleRangedAttackAction(ctx, char, "");
        if (shouldEmitAutoFireLine(line)) {
          markInCombat(ent);
          try {
            (ctx as any).sessions?.send?.((ctx as any).session, "mud_result", { text: "[combat] (auto) " + String(line).replace(/^\[combat\]\s*/, "") });
          } catch {
            // ignore
          }
        }
      } catch (err) {
        log.warn("autofire tick failed", { err: String(err), sessionId });
      }
    })();
  }, intervalMs);

  AUTOFIRES.set(sessionId, { timer, roomId, intervalMs });
  return "Autofire enabled.";
}

export function stopAutoFire(ctx: MudContext): string {
  const sessionId = (ctx as any).session?.id;
  if (!sessionId) return "Autofire cannot stop (no session).";
  const entry = AUTOFIRES.get(sessionId);
  if (!entry) return "Autofire is already off.";
  stopAutoFireForSession(sessionId);
  return "Autofire disabled.";
}

export function isAutoFireEnabledForSession(ctx: MudContext): boolean {
  const sessionId = (ctx as any).session?.id;
  if (!sessionId) return false;
  return AUTOFIRES.has(sessionId);
}
