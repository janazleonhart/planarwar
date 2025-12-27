// worldcore/ai/NpcBrainTypes.ts

/**
 * Minimal, engine-agnostic IDs and types for NPC AI.
 * These are intentionally generic so the same contracts
 * can be used in-process or over the wire (JSON).
 */

export type NpcId = string;
export type RoomId = string;
export type EntityId = string;
export type CharacterId = string;

/**
 * A very small view of a player for AI purposes.
 * We don't expose full character state here – just what AI needs.
 */
export interface PerceivedPlayer {
  entityId: EntityId;
  characterId?: CharacterId;
  hp: number;
  maxHp: number;
}

/**
 * What the AI “sees” about an NPC this tick.
 * This should be built by NpcManager or a dedicated perception layer.
 */
export interface NpcPerception {
  npcId: NpcId;
  entityId: EntityId;
  roomId: RoomId;

  hp: number;
  maxHp: number;
  alive: boolean;

  /**
   * Simple hostility flag for now. Later this can become
   * a faction/friend-or-foe matrix or behavior profile.
   */
  hostile: boolean;

  /**
   * Current target the NPC is focused on, if any.
   */
  currentTargetId?: EntityId;

  /**
   * All players currently in the same room that are
   * valid combat targets.
   */
  playersInRoom: PerceivedPlayer[];

  /**
   * Milliseconds since last decision tick for this NPC.
   * NpcManager can derive this from deltaMs and internal state.
   */
  sinceLastDecisionMs: number;
}

/**
 * AI decision types. These are high-level intentions,
 * not low-level instructions (no direct damage numbers here).
 */

export type NpcDecisionKind =
  | "idle"
  | "attack_entity"
  | "move_to_room"
  | "say"
  | "flee";

export interface NpcDecisionIdle {
  kind: "idle";
}

export interface NpcDecisionAttackEntity {
  kind: "attack_entity";
  targetEntityId: EntityId;

  /**
   * Optional hint: is this a melee swing, ranged shot,
   * or something else? For now just “melee”.
   */
  attackStyle?: "melee" | "ranged" | "spell";
}

export interface NpcDecisionMoveToRoom {
  kind: "move_to_room";
  toRoomId: RoomId;
}

export interface NpcDecisionSay {
  kind: "say";
  message: string;
}

export interface NpcDecisionFlee {
  kind: "flee";
  fromEntityId?: EntityId;
}

export type NpcDecision =
  | NpcDecisionIdle
  | NpcDecisionAttackEntity
  | NpcDecisionMoveToRoom
  | NpcDecisionSay
  | NpcDecisionFlee;

/**
 * NpcBrain is a pure decision function.
 * Given a perception for a single NPC and dt, return a decision or null.
 *
 * This can live:
 *  - in-process (LocalSimpleNpcBrain),
 *  - in a separate service (RemoteNpcBrainClient),
 *  - or be swapped per-NPC-type later.
 */
export interface NpcBrain {
  decide(perception: NpcPerception, dtMs: number): NpcDecision | null;
}
