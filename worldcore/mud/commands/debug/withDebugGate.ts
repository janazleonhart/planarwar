//worldcore/mud/commands/debug/withDebugGate.ts

import { requireDebug } from "../../../auth/debugGate";

import type { StaffRole } from "../../../auth/debugGate";

export function withDebugGate(
  handler: (ctx: any, char: any, input: any) => Promise<string>,
  minRole: StaffRole = "dev"
) {
  return async (ctx: any, char: any, input: any) => {
    const deny = requireDebug(ctx, minRole);
    if (deny) return deny;
    return handler(ctx, char, input);
  };
}
