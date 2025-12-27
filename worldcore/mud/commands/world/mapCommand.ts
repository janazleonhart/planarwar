//worldcore/mud/commands/world/mapCommand.ts

import { buildAsciiMap } from "../../MapRenderer";

export async function handleMapCommand(
  _ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[]; world?: any }
): Promise<string> {
  const world = input.world;
  if (!world) return "The world is unavailable.";

  // optional radius: map 3, map 7, etc.
  let radiusArg: number | undefined = undefined;
  if (input.args[0]) {
    const parsed = parseInt(input.args[0], 10);
    if (!Number.isNaN(parsed)) radiusArg = parsed;
  }

  return buildAsciiMap(world, char, radiusArg);
}
