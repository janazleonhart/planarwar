// worldcore/ai/NpcBrainTypes.ts

/**
 * Minimal engine-agnostic types for NPC AI.
 * These can be used in-process or over the wire (JSON)
 * if we move AI into its own service later.
 */

export type NpcId = string;
export type RoomId = string;
export type EntityId = string;
export type CharacterId = string;

/**
 * Minimal view of a player for AI purposes.
 */
export interface PerceivedPlayer {
  entityId: EntityId;
  characterId?: CharacterId;
  hp: number;
  maxHp: number;
}

/**
 * What the AI “sees” about an NPC at decision time.
 */
export interface NpcPerception {
  npcId: NpcId;
  entityId: EntityId;
  roomId: RoomId;

  hp: number;
  maxHp: number;
  alive: boolean;

  /**
   * Simple hostility flag for now.
   * Later: faction matrices / behavior profiles.
   */
  hostile: boolean;

  currentTargetId?: EntityId;

  playersInRoom: PerceivedPlayer[];

  /**
   * Milliseconds since last decision tick for this NPC.
   * For now we’ll just feed the frame delta into this.
   */
  sinceLastDecisionMs: number;
}

/**
 * High-level AI intentions – not raw damage numbers.
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
 * Pure NPC brain interface: given a perception and dt, return a decision.
 *
 * This is what an in-process brain OR a remote AI service both implement.
 */
export interface NpcBrain {
  decide(perception: NpcPerception, dtMs: number): NpcDecision | null;
}
