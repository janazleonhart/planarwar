//worldcore/mud/commands/player/inventoryCommand.ts

import { buildInventoryLines } from "../../../items/inventoryView";

export async function handleInventoryCommand(
  ctx: any,
  char: any
): Promise<string> {
  const lines = buildInventoryLines(ctx.items, char.inventory);
  return lines.join("\n");
}
