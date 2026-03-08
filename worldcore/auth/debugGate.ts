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

type DaemonRole = "readonly" | "editor" | "root";
const DAEMON_ROLE_RANK: Record<DaemonRole, number> = {
  readonly: 1,
  editor: 3,
  root: 4,
};

function envFlag(name: string, fallback = false): boolean {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function getServiceCommandAllowlist(identity: any): string[] {
  const direct = Array.isArray(identity?.serviceCommandAllowlist)
    ? identity.serviceCommandAllowlist
    : Array.isArray(identity?.flags?.serviceCommandAllowlist)
      ? identity.flags.serviceCommandAllowlist
      : [];
  return direct.map((s: unknown) => String(s).trim().toLowerCase()).filter(Boolean);
}

function canDaemonUseDebugCommand(identity: any, minRole: StaffRole, commandId?: string): boolean {
  if (!identity || identity.authKind !== "service") return false;

  const daemonRole = String(identity.serviceRole ?? "readonly").trim().toLowerCase() as DaemonRole;
  const daemonRank = DAEMON_ROLE_RANK[daemonRole] ?? 0;
  const neededRank = ROLE_RANK[minRole] ?? ROLE_RANK.dev;
  if (daemonRank < neededRank) return false;

  const allowlist = getServiceCommandAllowlist(identity);
  if (allowlist.length > 0) {
    const cmd = String(commandId ?? "").trim().toLowerCase();
    if (!allowlist.includes("*") && (!cmd || !allowlist.includes(cmd))) return false;
  }

  if (getShardMode() === "live" && !envFlag("PW_MMO_ALLOW_SERVICE_DEBUG_ON_LIVE", false)) {
    return false;
  }

  return true;
}

export function getShardMode(): "dev" | "live" {
  return process.env.PW_SHARD_MODE === "live" ? "live" : "dev";
}

export function canUseDebugCommands(ctx: any, minRole: StaffRole = "dev", commandId?: string): boolean {
  const identity = ctx?.session?.identity;
  if (!identity) return false;

  if (canDaemonUseDebugCommand(identity, minRole, commandId)) return true;

  const role = (getStaffRole(identity.flags) ?? "player") as StaffRole;
  if (ROLE_RANK[role] < ROLE_RANK[minRole]) return false;

  if (getShardMode() === "live") return false;

  return true;
}

export function requireDebug(ctx: any, minRole: StaffRole = "dev", commandId?: string): string | null {
  if (!ctx?.session?.identity) return "You are not logged in.";
  if (canUseDebugCommands(ctx, minRole, commandId)) return null;

  if (ctx?.session?.identity?.authKind !== "service" && getShardMode() === "live") {
    return "Debug commands are disabled on live shards.";
  }

  return "You are not allowed to use debug commands.";
}
