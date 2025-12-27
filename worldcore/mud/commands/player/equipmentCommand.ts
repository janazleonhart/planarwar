//worldcore/mud/commands/player/equipmentCommand.ts

import { equipFirstMatchingFromBags, unequipToBags } from "../../../items/equipmentOps";

export async function handleEquipCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[] }
): Promise<string> {
  const slot = input.args[0];
  if (!slot) return "Usage: equip <slot>";
  return equipFirstMatchingFromBags(ctx, char, slot);
}

export async function handleUnequipCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[] }
): Promise<string> {
  const slot = input.args[0];
  if (!slot) return "Usage: unequip <slot>";
  return unequipToBags(ctx, char, slot);
}
