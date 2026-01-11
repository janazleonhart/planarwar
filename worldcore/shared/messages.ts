//worldcore/shared/messages.ts

// -------------------------
// Opcode enums
// -------------------------

//worldcore/shared/messages.ts

// -------------------------
// Opcode enums
// -------------------------

export type ClientOpcode =
  | "hello"
  | "join_room"
  | "leave_room"
  | "list_rooms"
  | "ping"
  | "move"
  | "admin"
  | "set_target"
  | "cast"
  | "object_request"    // ask server for static objects/spawns
  | "terrain_request"   // legacy/simple terrain patch request
  | "terrain"           // envelope-style terrain ops (future WGEv3)
  | "heartbeat"
  | "chat"
  | "whereami"
  | "mud_result"
  | "action_result";

export type ServerOpcode =
  | "welcome"
  | "hello_ack"
  | "room_joined"
  | "room_left"
  | "room_list"
  | "error"
  | "pong"
  | "entity_list"
  | "entity_spawn"
  | "entity_update"
  | "entity_despawn"
  | "chat"
  | "terrain"
  | "world_blueprint"
  | "target_set"
  | "ability_cast"
  | "object_chunk"     // static objects/spawns for a shard/room
  | "whereami_result"
  | "mud_result"
  | "action_result";

// -------------------------
// Envelope types
// -------------------------

export interface ClientMessage {
  op: ClientOpcode;
  roomId?: string;
  payload?: any;
}

export interface ServerMessage<P = any> {
  op: ServerOpcode;
  nonce?: string;
  payload?: P;
}

export interface WhereAmIRequest {
  op: "whereami";
  payload: {};
}

export interface WhereAmIResultPayload {
  shardId: string;
  roomId: string | null;
  x: number;
  y: number;
  z: number;
  regionId: string | null;
  /** Optional DB-backed region metadata (debug/inspection). */
  regionName?: string;
  regionKind?: string;
  /** JSONB flags stored on regions.flags (PvP/event/warfront toggles). */
  regionFlags?: Record<string, unknown>;
}

export interface WhereAmIResultMessage {
  op: "whereami_result";
  payload: WhereAmIResultPayload;
}

export interface MudResultPayload {
  text: string;
  event?: "death" | "respawn";
}
