// worldcore/mud/commands/world/moveCommand.ts

import { moveCharacterAndSync } from "../../../movement/moveOps";
import { DIR_LABELS, parseMoveDir } from "../../../movement/MovementCommands";
import type { CharacterState } from "../../../characters/CharacterTypes";
import type { ServerWorldManager } from "../../../world/ServerWorldManager";
import { isGMOrHigher } from "../../../shared/AuthTypes";

function parseStepsToken(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  // allow: "64", "64," etc.
  const cleaned = raw.trim().replace(/,+$/, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return undefined;
  const i = Math.trunc(n);
  if (i <= 0) return undefined;
  return i;
}

function clampSteps(raw: number | undefined, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : 1;
  if (!Number.isFinite(n)) return 1;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

export async function handleMoveCommand(
  ctx: any,
  char: CharacterState,
  input: {
    cmd: string;
    args: string[];
    parts: string[];
    world?: ServerWorldManager;
  },
): Promise<string> {
  const world = input.world;
  if (!world) return "The world is unavailable.";

  const dir = parseMoveDir(input.args[0]);
  if (!dir) {
    return "Usage: move <n|s|e|w|ne|nw|se|sw> [steps]";
  }

  const requestedSteps = parseStepsToken(input.args[1]) ?? 1;
  const steps = clampSteps(requestedSteps, 1, 256);

  // Staff-only: multi-step movement is a dev/GM tool.
  // (Normal players will later get speed via mounts, buffs, teleport, etc.)
  if (steps > 1) {
    const flags = ctx?.session?.identity?.flags;
    if (!isGMOrHigher(flags)) {
      return "You can only move 1 step at a time.";
    }
  }

  const res = await moveCharacterAndSync(ctx, char, dir, world, steps);
  if (!res.ok) return res.reason;

  const label = DIR_LABELS[dir] ?? (input.args[0] ?? dir).toLowerCase();
  if (steps === 1) return `You move ${label}.`;
  return `You move ${label} (${steps} steps).`;
}
