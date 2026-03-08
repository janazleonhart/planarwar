// worldcore/mud/commands/debug/withDebugGate.ts

import type { MudCommandHandlerFn } from "../types";
import { requireDebug } from "../../../auth/debugGate";

/**
 * Wrap a debug/admin command with staff gating.
 */
export function withDebugGate(
  handler: MudCommandHandlerFn,
  minRole: "guide" | "gm" | "dev" | "owner" = "dev",
): MudCommandHandlerFn {
  return async (ctx: any, char: any, input: any) => {
    const commandId = String(input?.cmd ?? input?.parts?.[0] ?? "").trim().toLowerCase();
    const denied = requireDebug(ctx, minRole as any, commandId);
    if (denied) {
      return `[debug] ${denied}`;
    }

    return await handler(ctx, char, input);
  };
}
