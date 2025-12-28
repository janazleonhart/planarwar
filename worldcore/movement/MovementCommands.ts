// worldcore/movement/MovementCommands.ts

/**
 * Parses text directions into MoveDir tokens and applies simple, server-side
 * world walking. Movement is clamped to known regions; nav/collision rules
 * remain intentionally lightweight for v1.
 */

import { CharacterState } from "../characters/CharacterTypes";
import { ServerWorldManager } from "../world/ServerWorldManager";

export type MoveDir =
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw";

const DIR_VECTORS: Record<MoveDir, { dx: number; dz: number }> = {
  n: { dx: 0, dz: -1 },
  s: { dx: 0, dz: 1 },
  e: { dx: 1, dz: 0 },
  w: { dx: -1, dz: 0 },
  ne: { dx: 1, dz: -1 },
  nw: { dx: -1, dz: -1 },
  se: { dx: 1, dz: 1 },
  sw: { dx: -1, dz: 1 },
};

export function parseMoveDir(raw: string | undefined): MoveDir | null {
  if (!raw) return null;
  const t = raw.toLowerCase();

  switch (t) {
    case "n":
    case "north":
      return "n";
    case "s":
    case "south":
      return "s";
    case "e":
    case "east":
      return "e";
    case "w":
    case "west":
      return "w";
    case "ne":
    case "northeast":
      return "ne";
    case "nw":
    case "northwest":
      return "nw";
    case "se":
    case "southeast":
      return "se";
    case "sw":
    case "southwest":
      return "sw";
    default:
      return null;
  }
}

export interface MoveResult {
  ok: boolean;
  reason?: string;
}

/**
 * Server-authoritative movement. Y is left alone for now; we only walk in X/Z.
 */
export function tryMoveCharacter(
  char: CharacterState,
  dir: MoveDir,
  world: ServerWorldManager | undefined,
  stepSize = 1,
): MoveResult {
  if (!world) {
    return { ok: false, reason: "The world is unavailable." };
  }

  const v = DIR_VECTORS[dir];
  const nextX = char.posX + v.dx * stepSize;
  const nextZ = char.posZ + v.dz * stepSize;

  // Basic world bounds/region check for now.
  const insideWorld = world.isInsideWorld(nextX, nextZ);
  const region = insideWorld ? world.getRegionAt(nextX, nextZ) : undefined;
  if (!region) {
    return { ok: false, reason: "You cannot move that way." };
  }

  // TODO (later): nav grid / collision / cliffs / jump rules.

  // Commit the move.
  char.posX = nextX;
  char.posZ = nextZ;
  char.lastRegionId = region.id;

  return { ok: true };
}

export const DIR_LABELS: Record<MoveDir, string> = {
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
};
