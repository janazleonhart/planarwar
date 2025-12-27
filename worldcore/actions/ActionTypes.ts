// worldcore/actions/ActionTypes.ts

export type AttackChannel = "weapon" | "spell" | "ability";

/**
 * Generic attack request.
 *
 * v1: used by MUD and future 2.5D client.
 * - targetName: a loose name ("rat") that the server resolves in-room.
 * - targetId: once the client knows exact entityId, it can send that instead.
 */
export interface AttackActionRequest {
  kind: "attack";
  channel: AttackChannel;
  targetName?: string;
  targetId?: string;
}

/**
 * Generic harvest / gathering request.
 *
 * v1: we mostly care about targetName ("ore") and targetId.
 */
export interface HarvestActionRequest {
  kind: "harvest";
  resourceType?: "ore" | "herb" | "wood" | "fish";
  targetName?: string;
  targetId?: string;
}

/**
 * All supported world action requests.
 *
 * v1: attack + harvest only; later we can add:
 *  - interact
 *  - use_item
 *  - cast_spell
 *  - ability, etc.
 */
export type ActionRequest = AttackActionRequest | HarvestActionRequest;
