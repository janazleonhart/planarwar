//worldcore/mud/commands/world/saveCommand.ts

import { Logger } from "../../../utils/logger";

const log = Logger.scope("Save");

export async function handleSaveCommand(
  ctx: any,
  char: any,
  _input: { cmd: string; args: string[]; parts: string[] }
): Promise<string> {
  const userId = ctx.session.identity?.userId;
  if (!ctx.characters || !userId) {
    return "Save is not available right now.";
  }

  try {
    await ctx.characters.patchCharacter(userId, char.id, {
      posX: char.posX,
      posY: char.posY,
      posZ: char.posZ,
      lastRegionId: char.lastRegionId,
      attributes: char.attributes,
      inventory: char.inventory,
      equipment: char.equipment,
      spellbook: char.spellbook,
      abilities: char.abilities,
      progression: char.progression,
    });

    return "Character saved.";
  } catch (err) {
    log.warn("Manual save failed", { err: String(err), charId: char.id, userId });
    return "Save failed due to a server error.";
  }
}
