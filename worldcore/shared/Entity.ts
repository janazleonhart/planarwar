// worldcore/shared/Entity.ts

export interface Entity {
  id: string;

  // "player" or "npc" for now – expand later (pet, projectile, etc.)
  type: string;

  // Which room the entity belongs to
  roomId: string;

  // Owner session (for player-controlled entities)
  ownerSessionId?: string;

  // Optional owner entity id (for pets/minions that follow a player entity)
  ownerEntityId?: string;

  // Optional engaged target used by combat helpers (players store this too)
  engagedTargetId?: string;

  // Position
  x: number;
  y: number;
  z: number;

  // Facing (yaw around Y axis)
  // Optional for older tests that construct Entities without orientation.
  rotY?: number;

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
  protoId?: string; // stable prototype id (e.g. ore_vein_small)

  // Targeting (combat stub)
  targetId?: string;

  // --- Pet/minion fields (v1) ---

  // Optional pet class/profile id (v1.3)
  petClass?: string;

  // Optional pet tags (v1.3) used for profile resolution
  petTags?: string[];
  petMode?: "passive" | "defensive" | "aggressive";
  followOwner?: boolean;
}

export function getEntityRotY(e: Entity): number {
  return typeof e.rotY === "number" ? e.rotY : 0;


}
