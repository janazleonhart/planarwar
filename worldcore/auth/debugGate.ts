//worldcore/auth/debugGate.ts

import { getStaffRole } from "../shared/AuthTypes";

export type StaffRole = "player" | "helper" | "gm" | "dev" | "owner";

const ROLE_RANK: Record<StaffRole, number> = {
  player: 0,
  helper: 1,
  gm: 2,
  dev: 3,
  owner: 4,
};

export function getShardMode(): "dev" | "live" {
  return process.env.PW_SHARD_MODE === "live" ? "live" : "dev";
}

export function canUseDebugCommands(ctx: any, minRole: StaffRole = "dev"): boolean {
  const identity = ctx.session?.identity;
  if (!identity) return false;

  const role = (getStaffRole(identity.flags) ?? "player") as StaffRole;
  if (ROLE_RANK[role] < ROLE_RANK[minRole]) return false;

  // Hard rule: debug commands disabled on live unless you *explicitly* allow them
  if (getShardMode() === "live") return false;

  return true;
}

export function requireDebug(ctx: any, minRole: StaffRole = "dev"): string | null {
  if (!ctx.session?.identity) return "You are not logged in.";
  if (getShardMode() === "live") return "Debug commands are disabled on live shards.";
  if (!canUseDebugCommands(ctx, minRole)) return "You are not allowed to use debug commands.";
  return null;
}
