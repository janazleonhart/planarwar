// worldcore/mud/commands/debug/withDebugGate.ts

import type { MudCommandHandlerFn } from "../types";
import { requireDebug } from "../../../auth/debugGate";

/**
 * Wrap a debug/admin command with staff gating.
 *
 * We intentionally avoid being overly strict about the Session shape here,
 * because Session may evolve and AuthTypes are the canonical source of flags.
 */
export function withDebugGate(
  handler: MudCommandHandlerFn,
  minRole: "guide" | "gm" | "dev" | "owner" = "dev",
): MudCommandHandlerFn {
  return async (ctx: any, char: any, input: any) => {
    try {
      // Prefer the canonical identity flags if present.
      const flags =
        ctx?.session?.identity?.flags ??
        ctx?.session?.accountFlags ??
        ctx?.session?.flags ??
        ctx?.session;

      // requireDebug() is the authority; it throws on failure.
      requireDebug(flags as any, minRole as any);
    } catch (err: any) {
      return "[debug] Permission denied.";
    }

    // Preserve the handler return (string or null).
    return await handler(ctx, char, input);
  };
}
