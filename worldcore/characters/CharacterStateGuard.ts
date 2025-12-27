// worldcore/characters/CharacterStateGuard.ts

import { CharacterState } from "./CharacterTypes";
import { ServerWorldManager } from "../world/ServerWorldManager";
import { Logger } from "../utils/logger";

const log = Logger.scope("CHAR_GUARD");

export function hydrateCharacterRegion(
  char: CharacterState,
  world?: ServerWorldManager
): CharacterState {
  if (!world) return char;

  const region = world.getRegionAt(char.posX, char.posZ);
  const resolvedRegionId = region?.id ?? null;

  if (char.lastRegionId !== resolvedRegionId) {
    log.debug("Region hydration", {
      charId: char.id,
      old: char.lastRegionId,
      new: resolvedRegionId,
    });

    return {
      ...char,
      lastRegionId: resolvedRegionId,
    };
  }

  return char;
}
