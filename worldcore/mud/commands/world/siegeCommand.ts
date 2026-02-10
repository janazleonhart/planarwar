// worldcore/mud/commands/world/siegeCommand.ts

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";
import type { ServerWorldManager } from "../../../world/ServerWorldManager";
import {
  allowSiegeBreachForRegionSync,
  isEconomyLockdownOnSiegeForRegionSync,
  isTownSanctuaryForRegionSync,
  isTravelLockdownOnSiegeForRegionSync,
} from "../../../world/RegionFlags";

type CommandInput = {
  cmd: string;
  args: string[];
  parts: string[];
  world?: ServerWorldManager;
};

function getShardId(world: ServerWorldManager | undefined, fallback = "prime_shard"): string {
  try {
    const bp: any = world && (world as any).getWorldBlueprint?.();
    return String(bp?.shardId ?? bp?.id ?? fallback);
  } catch {
    return fallback;
  }
}

function splitRoomId(roomId: string): { shardId: string; regionId: string } | null {
  const idx = roomId.indexOf(":");
  if (idx <= 0) return null;
  return { shardId: roomId.slice(0, idx), regionId: roomId.slice(idx + 1) };
}

function fmtBool(v: boolean): string {
  return v ? "true" : "false";
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

export async function handleSiegeCommand(
  ctx: MudContext,
  char: CharacterState,
  input: CommandInput,
): Promise<string> {
  const world = input.world ?? (ctx as any).world;
  const sessionRoomId = String((ctx as any)?.session?.roomId ?? "").trim();

  // Prefer session roomId (authoritative for MUD commands). Fall back to char shard/region.
  const parsed = sessionRoomId ? splitRoomId(sessionRoomId) : null;
  const shardId = parsed?.shardId ?? String((char as any).shardId ?? getShardId(world));
  const regionId = parsed?.regionId ?? String((char as any).lastRegionId ?? "0,0");
  const roomId = `${shardId}:${regionId}`;

  const sanctuary = isTownSanctuaryForRegionSync(shardId, regionId);
  const allowBreach = allowSiegeBreachForRegionSync(shardId, regionId);
  const economyLockdown = isEconomyLockdownOnSiegeForRegionSync(shardId, regionId);
  const travelLockdown = isTravelLockdownOnSiegeForRegionSync(shardId, regionId);

  const now = Date.now();
  const townSiege = (ctx as any).townSiege;
  const st = townSiege?.getSiegeState?.(roomId, now) ?? null;
  const underSiege = !!st;
  const breachActive = !!townSiege?.isBreachActive?.(roomId, now);

  const siegeLeftMs = st ? Math.max(0, Number(st.untilTs ?? 0) - now) : 0;
  const breachLeftMs = st ? Math.max(0, Number(st.breachUntilTs ?? 0) - now) : 0;

  const lines: string[] = [];
  lines.push(`Siege status for ${roomId}`);
  lines.push(`Sanctuary: ${fmtBool(sanctuary)} (allowSiegeBreach=${fmtBool(allowBreach)})`);
  lines.push(`Under siege: ${fmtBool(underSiege)} (ttl=${fmtMs(siegeLeftMs)})`);
  lines.push(`Breach active: ${fmtBool(breachActive)} (ttl=${fmtMs(breachLeftMs)})`);
  lines.push(`Economy lockdown on siege: ${fmtBool(economyLockdown)}`);
  lines.push(`Travel lockdown on siege: ${fmtBool(travelLockdown)}`);

  if (!townSiege) {
    lines.push(`Note: TownSiegeService is not wired into this server instance.`);
  } else if (st) {
    // Extra debug context, but keep it compact.
    lines.push(
      `Last siege: pressure=${st.lastPressureCount} windowMs=${st.lastWindowMs} lastEvent=${fmtMs(now - st.lastEventTs)} ago`,
    );
  }

  return lines.join("\n");
}
