//worldcore/characters/characterPersist.ts

export async function persistCharacterSnapshot(ctx: any, char: any): Promise<void> {
    const userId = ctx.session.identity?.userId;
    if (!ctx.characters || !userId) throw new Error("persist unavailable");
  
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
  }
  