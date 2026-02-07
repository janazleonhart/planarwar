// worldcore/mud/MudCommandHandler.ts

import { ServerWorldManager } from "../world/ServerWorldManager";
import { CharacterState } from "../characters/CharacterTypes";
import { ensureRegenLoop } from "../systems/regen/ensureRegenLoop";
import {
  getTrainingDummyForRoom,
  computeTrainingDummyDamage,
  startTrainingDummyAi,
} from "./MudTrainingDummy";
import { performNpcAttack, type NpcAttackOptions } from "./actions/MudCombatActions";
import { COMMANDS } from "./commands/registry";
import type { MudContext } from "./MudContext";
import { DUEL_SERVICE } from "../pvp/DuelService";
import { findTargetPlayerEntityByName } from "../targeting/targetFinders";

const MUD_SERVICES = {
  trainingDummy: {
    getTrainingDummyForRoom,
    computeTrainingDummyDamage,
    startTrainingDummyAi,
  },
} as const;

// Commands that are NOT allowed while dead.
// Everything else is allowed (look, say, sheet, help, respawn, etc.).
const DEAD_BLOCKED_COMMANDS = new Set<string>([
  "attack",
  "autoattack",
  "autofire",
  "af",
  "shoot",
  "fire",
  "throw",
  "ranged",
  "taunt",
  "cast",
  "ability",
  "use_ability",
  "melody", // blocks melody add/start/stop while dead – cleaner for now

  "move",
  "walk",
  "go",
  "interact",
  "use",
  "talk",

  "trade",
  "vendor",
  "buy",
  "sell",
  "bank",
  "gbank",
  "guildbank",
  "auction",
  "ah",

  "craft",
  "pick",
  "mine",
]);

function isPlayerDead(ctx: MudContext, char: CharacterState): boolean {
  const entities = ctx.entities;
  const session = ctx.session;

  if (!entities || !session) {
    return false;
  }

  const ent = entities.getEntityByOwner(session.id);
  if (!ent) {
    // If we have no entity at all, treat as "not dead" for command purposes.
    // Respawn/attach flows will handle this separately.
    return false;
  }

  const e: any = ent;
  const hp =
    typeof e.hp === "number"
      ? e.hp
      : undefined;
  const aliveFlag =
    typeof e.alive === "boolean"
      ? e.alive
      : undefined;

  if (typeof hp === "number" && hp <= 0) {
    return true;
  }

  if (aliveFlag === false) {
    return true;
  }

  return false;
}

function syncPetFollow(ctx: MudContext): void {
  const em: any = (ctx as any)?.entities;
  const session: any = (ctx as any)?.session;
  if (!em || typeof em.getEntityByOwner !== "function" || typeof em.getPetByOwnerEntityId !== "function") return;

  const sid = String(session?.id ?? session?.sessionId ?? "").trim();
  if (!sid) return;

  const owner = em.getEntityByOwner(sid);
  if (!owner) return;

  const pet = em.getPetByOwnerEntityId(owner.id);
  if (!pet) return;

  // v1: if followOwner flag set, snap pet into owner's room
  const follow = (pet as any).followOwner === true;
  if (!follow) return;

  if (pet.roomId !== owner.roomId) {
    pet.roomId = owner.roomId;
  }
}


function envInt(name: string, fallback: number): number {
  const raw = String((process.env as any)?.[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = String((process.env as any)?.[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = String((process.env as any)?.[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "y" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "n" || raw === "off") return false;
  return fallback;
}

export async function maybePetAutoAttackAfterCommand(
  ctx: MudContext,
  char: CharacterState,
  verb: string,
  opts?: {
    now?: number;
    perform?: typeof performNpcAttack;
  }
): Promise<string | undefined> {
  // Skip on explicit pet commands to avoid double-swing.
  if (String(verb) === "pet") return undefined;

  const enabled = envBool("PW_PET_AI_ENABLED", true);
  if (!enabled) return undefined;

  const em: any = (ctx as any)?.entities;
  const session: any = (ctx as any)?.session;
  if (!em || typeof em.getEntityByOwner !== "function" || typeof em.getPetByOwnerEntityId !== "function") return undefined;

  const sid = String(session?.id ?? session?.sessionId ?? "").trim();
  if (!sid) return undefined;

  const owner = em.getEntityByOwner(sid);
  if (!owner) return undefined;

  const pet = em.getPetByOwnerEntityId(owner.id);
  if (!pet) return undefined;

  const mode = String((pet as any).petMode ?? "defensive").toLowerCase();
  if (mode === "passive") return undefined;

  // Must be in same room to act (v1.1).
  if (String(pet.roomId) !== String(owner.roomId)) return undefined;

  // Must have an engaged target to assist (v1.1).
  const engagedId = String((owner as any).engagedTargetId ?? "").trim();
  if (!engagedId) return undefined;

  const roomId = String(owner.roomId ?? "");
  const ents: any[] = em.getEntitiesInRoom?.(roomId) ?? [];
  const target = ents.find((e: any) => String(e?.id ?? "") === engagedId);
  if (!target) return undefined;
  if ((target as any).alive === false || (target as any).hp <= 0) return undefined;

  const now = typeof opts?.now === "number" ? opts!.now : Date.now();
  const cdMs = Math.max(0, envInt("PW_PET_AI_COOLDOWN_MS", 1200));
  const nextAt = Number((pet as any)._pwPetAiNextAt ?? 0);
  if (Number.isFinite(nextAt) && now < nextAt) return undefined;
  (pet as any)._pwPetAiNextAt = now + cdMs;

  const dmgMult = Math.max(0, envNumber("PW_PET_DAMAGE_MULT", 0.8));
  const attackOpts: NpcAttackOptions = { damageMultiplier: dmgMult };

  const perform = opts?.perform ?? performNpcAttack;
  const line = await perform(ctx, char, pet as any, target as any, attackOpts);
  return line ? `[pet] ${String(line).replace(/^\[(world|combat)\]\s*/i, "")}` : undefined;
}


export async function handleMudCommand(
  char: CharacterState,
  input: string,
  world: ServerWorldManager | undefined,
  ctx: MudContext
): Promise<string | null> {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/);
  const verb = parts[0].toLowerCase();
  const args = parts.slice(1);

  // Make sure regen / periodic systems are running
  ensureRegenLoop(ctx);


  // Duel plumbing (dormant PvP): handshake commands live here so we don't have to
  // touch the command registry yet.
  //
  // Commands:
  //   duel <playerName>     - challenge a player in the same room (expires quickly)
  //   accept [playerName]   - accept a pending duel (optionally specify challenger)
  //   decline <playerName>  - decline a duel request
  //   yield | forfeit       - end an active duel
  if (verb === "duel" || verb === "accept" || verb === "decline" || verb === "yield" || verb === "forfeit") {
    const now = Date.now();
    DUEL_SERVICE.tick(now);

    if (!ctx.entities) {
      return "Dueling is not available here (no entity manager).";
    }

    const selfEnt = ctx.entities.getEntityByOwner(ctx.session.id);
    if (!selfEnt) {
      return "You have no body here.";
    }

    const roomId = selfEnt.roomId ?? char.shardId;

    // dead players can't initiate/accept/decline duels (keeps it tidy)
    if ((verb === "duel" || verb === "accept" || verb === "decline") && isPlayerDead(ctx, char)) {
      return "You are dead and cannot duel right now.";
    }

    const getTargetChar = (targetEnt: any) => {
      const sid = targetEnt?.ownerSessionId as string | undefined;
      const s = sid ? ctx.sessions?.get(sid) : null;
      const c = (s as any)?.character ?? (s as any)?.char ?? null;
      return { session: s, char: c };
    };

    if (verb === "duel") {
      const targetNameRaw = args.join(" ").trim();
      if (!targetNameRaw) {
        const active = DUEL_SERVICE.getActiveDuel(char.id);
        if (active) {
          const oppName = active.aCharId === char.id ? active.bName : active.aName;
          return `[duel] You are in an active duel with ${oppName}.`;
        }
        const pending = DUEL_SERVICE.listPendingForTarget(char.id, now);
        if (pending.length > 0) {
          const list = pending.map((r) => r.fromName).join(", ");
          return `[duel] Pending duel requests from: ${list}. Use: accept <name> or decline <name>.`;
        }
        return "Usage: duel <playerName>";
      }

      const targetEnt = findTargetPlayerEntityByName(ctx, roomId, targetNameRaw);
      if (!targetEnt) return `[duel] There is no '${targetNameRaw}' here to duel.`;
      if ((targetEnt as any).ownerSessionId === ctx.session.id) return "[duel] You cannot duel yourself.";

      const { session: targetSession, char: targetChar } = getTargetChar(targetEnt as any);
      if (!targetChar?.id) return "[duel] That player cannot be dueled right now (no character attached).";

      const res = DUEL_SERVICE.requestDuel(
        char.id,
        (selfEnt as any).name ?? "Unknown",
        targetChar.id,
        (targetEnt as any).name ?? "Unknown",
        roomId,
        now
      );

      if (!res.ok) return `[duel] ${res.reason}`;

      if (targetSession && ctx.sessions) {
        ctx.sessions.send(targetSession as any, "chat", {
          from: "[world]",
          sessionId: "system",
          text: `[duel] ${(selfEnt as any).name} challenges you to a duel. Type: accept ${(selfEnt as any).name}  (or: decline ${(selfEnt as any).name})`,
          t: now,
        });
      }

      return `[duel] You challenge ${(targetEnt as any).name} to a duel.`;
    }

    if (verb === "accept") {
      const nameRaw = args.join(" ").trim();

      if (!nameRaw) {
        const res = DUEL_SERVICE.acceptAny(char.id, roomId, now);
        if (!res.ok) return `[duel] ${res.reason}`;

        const oppName = res.duel.aCharId === char.id ? res.duel.bName : res.duel.aName;
        const oppEnt = findTargetPlayerEntityByName(ctx, roomId, oppName);
        if (oppEnt) {
          const { session: oppSession } = getTargetChar(oppEnt as any);
          if (oppSession && ctx.sessions) {
            ctx.sessions.send(oppSession as any, "chat", {
              from: "[world]",
              sessionId: "system",
              text: `[duel] ${(selfEnt as any).name} accepts your duel. Fight! (You may now attack each other.)`,
              t: now,
            });
          }
        }

        return `[duel] Duel accepted. You are now dueling ${oppName}.`;
      }

      const challengerEnt = findTargetPlayerEntityByName(ctx, roomId, nameRaw);
      if (!challengerEnt) return `[duel] There is no '${nameRaw}' here.`;

      const { session: challengerSession, char: challengerChar } = getTargetChar(challengerEnt as any);
      if (!challengerChar?.id) return "[duel] That player has no character attached.";

      const res = DUEL_SERVICE.acceptDuel(char.id, challengerChar.id, roomId, now);
      if (!res.ok) return `[duel] ${res.reason}`;

      if (challengerSession && ctx.sessions) {
        ctx.sessions.send(challengerSession as any, "chat", {
          from: "[world]",
          sessionId: "system",
          text: `[duel] ${(selfEnt as any).name} accepts your duel. Fight! (You may now attack each other.)`,
          t: now,
        });
      }

      return `[duel] Duel accepted. You are now dueling ${(challengerEnt as any).name}.`;
    }

    if (verb === "decline") {
      const nameRaw = args.join(" ").trim();
      if (!nameRaw) return "Usage: decline <playerName>";

      const challengerEnt = findTargetPlayerEntityByName(ctx, roomId, nameRaw);
      if (!challengerEnt) return `[duel] There is no '${nameRaw}' here.`;

      const { session: challengerSession, char: challengerChar } = getTargetChar(challengerEnt as any);
      if (!challengerChar?.id) return "[duel] That player has no character attached.";

      const res = DUEL_SERVICE.declineDuel(char.id, challengerChar.id, now);
      if (!res.ok) return `[duel] ${res.reason}`;

      if (challengerSession && ctx.sessions) {
        ctx.sessions.send(challengerSession as any, "chat", {
          from: "[world]",
          sessionId: "system",
          text: `[duel] ${(selfEnt as any).name} declines your duel request.`,
          t: now,
        });
      }

      return `[duel] You decline ${(challengerEnt as any).name}'s duel request.`;
    }

    // yield / forfeit
    const active = DUEL_SERVICE.getActiveDuel(char.id);
    if (!active) return "[duel] You are not in a duel.";

    const oppName = active.aCharId === char.id ? active.bName : active.aName;
    const end = DUEL_SERVICE.endDuelFor(char.id, "yield", now);
    if (!end.ok) return `[duel] ${end.reason}`;

    const oppEnt = findTargetPlayerEntityByName(ctx, roomId, oppName);
    if (oppEnt) {
      const { session: oppSession } = getTargetChar(oppEnt as any);
      if (oppSession && ctx.sessions) {
        ctx.sessions.send(oppSession as any, "chat", {
          from: "[world]",
          sessionId: "system",
          text: `[duel] ${(selfEnt as any).name} yields. The duel ends.`,
          t: now,
        });
      }
    }

    return `[duel] You yield. Your duel with ${oppName} ends.`;
  }


  const handler = COMMANDS[verb];
  if (!handler) {
    return `Unknown command: ${input}`;
  }

  // Global dead-state gate
  if (isPlayerDead(ctx, char) && DEAD_BLOCKED_COMMANDS.has(verb)) {
    return "You are dead and cannot do that. Use 'respawn' to return to safety or wait for someone to resurrect you.";
  }

  const out = await handler(ctx, char, {
    cmd: verb,
    args,
    parts,
    world,
    services: MUD_SERVICES,
  });

  // Pet follow sync (v1): if you moved rooms and your pet is set to follow, snap it along.
  syncPetFollow(ctx);

  // Pet AI-lite (v1.1): opportunistic one-swing assist after player commands while engaged.
  let petLine: string | undefined = undefined;
  try {
    petLine = await maybePetAutoAttackAfterCommand(ctx, char, verb);
  } catch {
    // Never break command output.
  }

  return petLine ? String(out) + "\n" + petLine : out;
}
