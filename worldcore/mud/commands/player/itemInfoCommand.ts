//worldcore/mud/commands/player/itemInfoCommand.ts

import { getItemTooltip } from "../../../items/ItemDisplay";

export async function handleItemInfoCommand(
  ctx: any,
  _char: any,
  input: { cmd: string; args: string[]; parts: string[] }
): Promise<string> {
  const token = input.args[0];
  if (!token) return "Usage: iteminfo <itemIdOrName>";

  const tip = getItemTooltip(ctx.items, token);
  if (!tip) {
    return `No item found for '${token}'. (Checked DB and static catalog.)`;
  }

  const lines: string[] = [];
  lines.push(`[item] ${tip.label}`);

  for (const line of tip.lines ?? []) {
    lines.push(`  ${line}`);
  }

  // optional; harmless even if label includes it
  lines.push(`  rarity: ${tip.rarity}`);

  return lines.join("\n");
}
