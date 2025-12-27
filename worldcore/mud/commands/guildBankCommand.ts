// worldcore/mud/commands/guildBankCommand.ts

import { handleBankCommand as handleBankOpsCommand } from "../../bank/bankOps";

export async function handleGuildBankCommand(
  ctx: any,
  char: any,
  args: string[]
): Promise<string> {
  if (!ctx.bank) return "[bank] Bank service unavailable.";

  // v1: simple assumption that character has guildId;
  // later, plug into GuildService for ranks/permissions.
  const guildId = char.guildId;
  if (!guildId) {
    return "[bank] You are not in a guild.";
  }

  const owner = { ownerId: guildId, ownerKind: "guild" as const };

  return handleBankOpsCommand(
    { bank: ctx.bank, items: ctx.items },
    owner,
    char,
    args
  );
}
