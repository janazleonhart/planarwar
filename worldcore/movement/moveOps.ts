//worldcore/movement/moveOps.ts

/**
 * High-level movement helper that applies a move, syncs the in-memory entity,
 * and best-effort persists the character position without blocking gameplay.
 */

import type { CharacterState } from "../characters/CharacterTypes";
import type { EntityManager } from "../core/EntityManager";
import type { Session } from "../shared/Session";
import { Logger } from "../utils/logger";
import type { ServerWorldManager } from "../world/ServerWorldManager";
import type { PostgresCharacterService } from "../characters/PostgresCharacterService";
import { tryMoveCharacter, type MoveDir } from "./MovementCommands";

const log = Logger.scope("MoveOps");

type CharacterStore = Pick<PostgresCharacterService, "patchCharacter">;

export type MoveOpsContext = {
  session: Pick<Session, "id" | "identity">;
  entities?: Pick<EntityManager, "getEntityByOwner">;
  characters?: CharacterStore;
};

export type MoveOpsResult = { ok: true } | { ok: false; reason: string };

export async function moveCharacterAndSync(
  ctx: MoveOpsContext,
  char: CharacterState,
  dir: MoveDir,
  world: ServerWorldManager | undefined,
): Promise<MoveOpsResult> {
  const result = tryMoveCharacter(char, dir, world);
  if (!result.ok) {
    return { ok: false, reason: result.reason ?? "You cannot move that way." };
  }

  // Sync entity position in memory, if present.
  const entity = ctx.entities?.getEntityByOwner(ctx.session.id) as any;
  if (entity) {
    entity.x = char.posX;
    entity.y = char.posY;
    entity.z = char.posZ;
  }

  // Persist movement best-effort (don’t block movement on DB).
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
