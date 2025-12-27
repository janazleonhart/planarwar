// worldcore/mud/MudCommandHandler.ts

import { ServerWorldManager } from "../world/ServerWorldManager";
import { CharacterState } from "../characters/CharacterTypes";
import { ensureRegenLoop } from "../systems/regen/ensureRegenLoop";
import {
  getTrainingDummyForRoom,
  computeTrainingDummyDamage,
  startTrainingDummyAi,
} from "./MudTrainingDummy";
import { COMMANDS } from "./commands/registry";
import type { MudContext } from "./MudContext";

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

  const handler = COMMANDS[verb];
  if (!handler) {
    return `Unknown command: ${input}`;
  }

  // Global dead-state gate
  if (isPlayerDead(ctx, char) && DEAD_BLOCKED_COMMANDS.has(verb)) {
    return "You are dead and cannot do that. Use 'respawn' to return to safety or wait for someone to resurrect you.";
  }

  return await handler(ctx, char, {
    cmd: verb,
    args,
    parts,
    world,
    services: MUD_SERVICES,
  });
}
