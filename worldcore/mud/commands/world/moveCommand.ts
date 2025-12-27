//worldcore/mud/commands/world/moveCommand.ts

import { moveCharacterAndSync } from "../../../movement/moveOps";
import { parseMoveDir, DIR_LABELS } from "../../../movement/MovementCommands"; 

import type { ServerWorldManager } from "../../../world/ServerWorldManager";
import type { CharacterState } from "../../../characters/CharacterTypes";

export async function handleMoveCommand(
  ctx: any,
  char: CharacterState,
  input: { cmd: string; args: string[]; parts: string[]; world?: ServerWorldManager }
): Promise<string> {
  const world = input.world;
  if (!world) return "The world is unavailable.";

  const dir = parseMoveDir(input.args[0]);
  if (!dir) return "Usage: move <north|south|east|west|ne|nw|se|sw>";

  const res = await moveCharacterAndSync(ctx, char, dir, world);
  if (!res.ok) return res.reason;

  const label = DIR_LABELS[dir] ?? (input.args[0] ?? dir).toLowerCase();
  return `You move ${label}.`;
}