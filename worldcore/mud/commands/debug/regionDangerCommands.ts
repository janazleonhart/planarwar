// worldcore/mud/commands/debug/regionDangerCommands.ts
//
// Debug helpers for inspecting and nudging RegionDanger.
//
// Exposes two commands (via registry.ts):
//   - debug_region_danger [regionId]
//   - debug_bump_region_danger <amount> [regionId]
//
// If regionId is omitted, we derive it from the character's lastRegionId
// or fall back to "<shardId>:0,0".

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";
import type { MudCommandInput } from "../types";
import {
  getRegionDangerSnapshotForRegionId,
  bumpRegionDanger,
} from "../../../world/RegionDanger";

function getRegionIdFromChar(char: CharacterState): string | null {
  const anyChar: any = char as any;
  const lastRegionId = anyChar.lastRegionId;

  if (typeof lastRegionId === "string" && lastRegionId.length > 0) {
    return lastRegionId;
  }

  if (char.shardId) {
    return `${char.shardId}:0,0`;
  }

  return null;
}

/**
 * debug_region_danger [regionId]
 *
 * Show current tier/baseTier/score + recent sources for a region.
 * If regionId is omitted, we use the player's current region.
 */
export async function handleDebugRegionDanger(
  _ctx: MudContext,
  char: CharacterState,
  input: MudCommandInput,
): Promise<string> {
  // If the user provided an explicit region, use that.
  const explicitRegion =
    typeof input.args[0] === "string" && input.args[0].length > 0
      ? input.args[0]
      : null;

  const regionId = explicitRegion ?? getRegionIdFromChar(char);

  if (!regionId) {
    return "[danger] No region information available for your character.";
  }

  const now = Date.now();
  const snap = getRegionDangerSnapshotForRegionId(regionId, now);

  const lines: string[] = [];

  lines.push(
    `[danger] Region ${snap.regionId}: tier ${snap.tier} (base ${snap.baseTier}), score=${snap.score.toFixed(
      1,
    )}`,
  );

  if (snap.sources.length) {
    lines.push(`[danger] Recent sources: ${snap.sources.join(", ")}`);
  } else {
    lines.push("[danger] Recent sources: (none)");
  }

  if (snap.lastUpdatedMs) {
    const ageSec = Math.floor((now - snap.lastUpdatedMs) / 1000);
    lines.push(`[danger] Last updated: ${ageSec}s ago`);
  } else {
    lines.push("[danger] Last updated: (never)");
  }

  lines.push(
    "[danger] Usage: debug_region_danger [regionId] — omit regionId to use your current region.",
  );

  return lines.join("\n");
}

/**
 * debug_bump_region_danger <amount> [regionId]
 *
 * Adjust the region's danger score by the given amount (positive or negative),
 * then show the resulting tier/score snapshot.
 */
export async function handleDebugBumpRegionDanger(
  ctx: MudContext,
  char: CharacterState,
  input: MudCommandInput,
): Promise<string> {
  const amountRaw = input.args[0];
  const amount = Number(amountRaw ?? "0");

  if (!Number.isFinite(amount) || amount === 0) {
    return "[danger] Usage: debug_bump_region_danger <amount> [regionId]";
  }

  // Second arg can be an explicit region override.
  const regionArg =
    typeof input.args[1] === "string" && input.args[1].length > 0
      ? input.args[1]
      : null;

  const regionId = regionArg ?? getRegionIdFromChar(char);

  if (!regionId) {
    return "[danger] No region information available for your character.";
  }

  const now = Date.now();
  const source = `debug_bump_region_danger:${ctx.session?.identity?.displayName ?? "unknown"}`;

  bumpRegionDanger(regionId, amount, source, now);

  const snap = getRegionDangerSnapshotForRegionId(regionId, now);

  const sign = amount > 0 ? "+" : "";
  const lines: string[] = [];

  lines.push(
    `[danger] Bumped region ${snap.regionId} by ${sign}${amount}.`,
  );
  lines.push(
    `[danger] Now: tier ${snap.tier} (base ${snap.baseTier}), score=${snap.score.toFixed(
      1,
    )}`,
  );

  if (snap.sources.length) {
    lines.push(`[danger] Recent sources: ${snap.sources.join(", ")}`);
  }

  return lines.join("\n");
}
