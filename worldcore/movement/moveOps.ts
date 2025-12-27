//worldcore/movement/moveOps.ts

import { Logger } from "../utils/logger";
import type { CharacterState } from "../characters/CharacterTypes";
import type { ServerWorldManager } from "../world/ServerWorldManager";
import { tryMoveCharacter } from "./MovementCommands";

import type { MoveDir } from "./MovementCommands";

const log = Logger.scope("MoveOps");

export type MoveOpsContext = {
  session: { id: string; identity?: { userId: string } };
  entities?: { getEntityByOwner(ownerId: string): any | null | undefined };
  characters?: {
    patchCharacter(userId: string, charId: string, patch: any): Promise<any>;
  };
};

export type MoveOpsResult =
  | { ok: true }
  | { ok: false; reason: string };

export async function moveCharacterAndSync(
  ctx: MoveOpsContext,
  char: CharacterState,
  dir: MoveDir,
  world: ServerWorldManager | undefined
): Promise<MoveOpsResult> {
  const result = tryMoveCharacter(char, dir, world);
  if (!result.ok) {
    return { ok: false, reason: result.reason ?? "You cannot move that way." };
  }

  // Sync entity position in memory, if present
  if (ctx.entities) {
    const ent = ctx.entities.getEntityByOwner(ctx.session.id);
    if (ent) {
      ent.x = char.posX;
      ent.y = char.posY;
      ent.z = char.posZ;
    }
  }

  // Persist movement best-effort (don’t block movement on DB)
  const userId = ctx.session.identity?.userId;
  if (ctx.characters && userId) {
    ctx.characters
      .patchCharacter(userId, char.id, {
        posX: char.posX,
        posY: char.posY,
        posZ: char.posZ,
        lastRegionId: char.lastRegionId,
      })
      .catch((err: any) => {
        log.warn("Failed to persist character movement", {
          err: String(err),
          charId: char.id,
          userId,
        });
      });
  }

  return { ok: true };
}
