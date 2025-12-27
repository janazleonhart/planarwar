// worldcore/shared/Entity.ts

export interface Entity {
  id: string;

  // "player" or "npc" for now – expand later (pet, projectile, etc.)
  type: string;

  // Which room the entity belongs to
  roomId: string;

  // Owner session (for player-controlled entities)
  ownerSessionId?: string;

  // Position
  x: number;
  y: number;
  z: number;

  // Facing (yaw around Y axis)
  rotY: number;

  // Basic health (stub for now)
  hp: number;
  maxHp: number;
  alive: boolean;

  // Cosmetic / label
  name: string;

  // NPC-only
  model?: string;

  // World-object metadata (nodes/resources/etc.)
  spawnPointId?: number; // DB spawn_points.id (used for personal depletion)
  protoId?: string;      // stable prototype id (e.g. ore_vein_small)

  // Targeting (combat stub)
  targetId?: string;
}
