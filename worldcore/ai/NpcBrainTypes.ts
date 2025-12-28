// worldcore/ai/NpcBrainTypes.ts

/**
 * Minimal engine-agnostic types for NPC AI.
 * These can be used in-process or over the wire (JSON)
 * if we move AI into its own service later.
 */

import type { NpcBehavior } from "../npc/NpcTypes";

export type NpcId = string;
export type RoomId = string;
export type EntityId = string;
export type CharacterId = string;

/**
 * Simplified representation of a player in the same room.
 */
export interface PerceivedPlayer {
  entityId: EntityId;
  characterId?: CharacterId;
  hp: number;
  maxHp: number;
  recentCrimeUntil?: number;
  recentCrimeSeverity?: "minor" | "severe";
  combatRole?: "tank" | "healer" | "dps";
}

/**
 * What the brain "sees" each tick.
 */
export interface NpcPerception {
  npcId: NpcId;
  entityId: EntityId;
  roomId: RoomId;

  hp: number;
  maxHp: number;
  alive: boolean;

  behavior: NpcBehavior;
  hostile: boolean;

  currentTargetId?: EntityId;
  lastAttackerId?: EntityId;
  lastAggroAt?: number;

  playersInRoom: PerceivedPlayer[];
  guardProfile?: "village" | "town" | "city";
  guardCallRadius?: number;
  roomIsSafeHub?: boolean;
  npcName?: string;

  /** Milliseconds since last decision for this NPC. */
  sinceLastDecisionMs: number;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

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
  roomId: RoomId;
}

export interface NpcDecisionSay {
  kind: "say";
  text: string;
}

export interface NpcDecisionFlee {
  kind: "flee";
  /** Optional entity to flee from; for logging/UI only. */
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
