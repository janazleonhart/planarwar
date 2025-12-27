// worldcore/mud/MudCommandHandler.ts

import { ServerWorldManager } from "../world/ServerWorldManager";
import { CharacterState } from "../characters/CharacterTypes";
import { ensureRegenLoop } from "../systems/regen/ensureRegenLoop";
import { getTrainingDummyForRoom, computeTrainingDummyDamage, startTrainingDummyAi } from "./MudTrainingDummy";
import { COMMANDS } from "./commands/registry";
import type { MudContext } from "./MudContext";

const MUD_SERVICES = {
  trainingDummy: {
    getTrainingDummyForRoom,
    computeTrainingDummyDamage,
    startTrainingDummyAi,
  },
} as const;

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

  ensureRegenLoop(ctx);

  const handler = COMMANDS[verb];
  if (handler) {
    return await handler(ctx, char, { cmd: verb, args, parts, world, services: MUD_SERVICES });
  }

  return `Unknown command: ${input}`;
}