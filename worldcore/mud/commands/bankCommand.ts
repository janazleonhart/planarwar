//worldcore/mud/commands/bankCommand.ts

import { handleBankCommand as handleBankOpsCommand } from "../../bank/bankOps";

export async function handleBankCommand(ctx: any, char: any, args: string[]) {
  const ident = ctx.session?.identity;
  const owner = ident
    ? { ownerId: ident.userId, ownerKind: "account" as const }
    : { ownerId: char.id, ownerKind: "character" as const };

  return handleBankOpsCommand({ bank: ctx.bank, items: ctx.items }, owner, char, args);
}