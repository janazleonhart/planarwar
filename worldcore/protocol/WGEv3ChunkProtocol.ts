// worldcore/protocol/WGEv3ChunkProtocol.ts

// PLANAR WAR – WGEv3 Chunk Protocol (Backend)
//
// Single source of truth for terrain streaming:
//  - Chunk coordinate system
//  - Client <-> Server terrain message types
//  - Versioning
//
// This is a modernized port of the old src/protocol/WGEv3ChunkProtocol.ts
// fossil. It is intentionally *not yet* wired into TerrainStream v1, but
// will be used when we move to envelope-style "terrain" messages.
//
// Typical pattern on the wire:
//
//   ClientMessage {
//     op: "terrain",
//     payload: ClientTerrainMessage
//   }
//
//   ServerMessage {
//     op: "terrain",
//     payload: ServerTerrainMessage
//   }

export const TERRAIN_PROTOCOL_VERSION = 3;

// ---------------------------------------------------------------------------
// Coordinate system
// ---------------------------------------------------------------------------

/**
 * Integer chunk coordinates in terrain grid space.
 * (0,0) is arbitrary; typically mapped to some world-space origin.
 */
export interface TerrainChunkCoord {
  cx: number; // chunk x index
  cz: number; // chunk z index
}

/**
 * Chunk identifier with optional LOD level.
 */
export interface TerrainChunkId extends TerrainChunkCoord {
  lod: number; // 0 = full res, 1+ = downsampled
}

// ---------------------------------------------------------------------------
// Blueprint meta
// ---------------------------------------------------------------------------

/**
 * Global terrain blueprint metadata the client needs to interpret chunks.
 */
export interface TerrainBlueprintMeta {
  worldId: string;
  seed: number;
  width: number;
  height: number;
  chunkSize: number;
  protocolVersion: number;

  // Optional: height scaling for rendering.
  // normalizedElevation * heightScale => world units.
  heightScale?: number;
}

// ---------------------------------------------------------------------------
// 2.5D Tile Layer (for web / MUD / iso clients)
// ---------------------------------------------------------------------------

/**
 * Optional 2.5D tileset layer to render an isometric / top-down view.
 *
 * This is *additive* — 3D clients can ignore it; 2.5D/web frontends can
 * treat this as their primary render source.
 */
export interface IsoTileLayerWire {
  /**
   * Atlas identifier (e.g. "pw_terrain_basic_v1").
   * The client maps this to a spritesheet/tileset.
   */
  atlasId: string;

  /**
   * Tile IDs in row-major order.
   * length = size * size (same size as the elevation field).
   *
   * The concrete mapping (id -> sprite frame) is client-side,
   * but we’ll keep a shared doc/enum so both ends agree.
   */
  tiles: number[];

  /**
   * Optional variant/index layer (e.g. auto-tiling masks, random variations).
   * Same length as tiles.
   */
  variant?: number[];
}

// ---------------------------------------------------------------------------
// Chunk payload
// ---------------------------------------------------------------------------

/**
 * Terrain chunk data in a “wire friendly” format (numbers only).
 *
 * Actual engine-side representation can use TypedArrays; this interface
 * is what goes over JSON.
 */
export interface TerrainChunkDataWire {
  id: TerrainChunkId;

  // Chunk bounds in the global grid
  originX: number; // cell index of lower-left corner
  originZ: number; // cell index of lower-left corner
  size: number; // chunkSize (for sanity check)

  /**
   * Elevation data packed as unsigned 16-bit integers.
   *  - length = size * size
   *  - normalized elevation = (value / 65535.0) in [-1,1] or [0,1]
   *    depending on convention and heightScale.
   */
  elevation: number[];

  /**
   * Biome IDs, one per cell (Uint16 in practice).
   */
  biome: number[];

  /**
   * Hydrology masks.
   *  - rivers[i] = 1 if river, else 0
   *  - lakes[i]  = 1 if lake, else 0
   */
  rivers: number[];
  lakes: number[];

  /**
   * Climate info (optional for some LOD levels).
   *  - temperature: scaled float -> int16-ish:
   *      temp = round(value * 10)
   *  - moisture: 0..255 as uint8-ish
   */
  temperature: number[]; // int16-ish
  moisture: number[]; // uint8-ish
  climateZone: number[]; // uint8 climate zone code

  /**
   * Resource masks (0/1 per cell).
   */
  resourceOre: number[];
  resourceHerb: number[];
  resourceWood: number[];
  resourceFish: number[];
  resourceRare: number[];

  /**
   * Optional debug flags or overlays (for dev tools, heatmaps, etc.).
   */
  debugFlags?: number[];

  /**
   * Optional 2.5D tileset layer for web / isometric clients.
   * 3D clients can ignore this entirely.
   */
  isoTiles?: IsoTileLayerWire;
}

// ---------------------------------------------------------------------------
// Client → Server terrain messages
// ---------------------------------------------------------------------------

export type ClientTerrainMessageKind =
  | "terrain_subscribe"
  | "terrain_unsubscribe"
  | "terrain_set_center"
  | "terrain_debug_inspect";

/**
 * Base envelope for client→server terrain messages.
 */
export interface ClientTerrainMessageEnvelope {
  kind: ClientTerrainMessageKind;
}

/**
 * Subscribe to terrain streaming around a given center point.
 * The server will begin sending terrain_blueprint_meta and terrain_chunk_data.
 */
export interface TerrainSubscribeMessage
  extends ClientTerrainMessageEnvelope {
  kind: "terrain_subscribe";

  worldId: string;

  // Initial center in world/grid space (server decides, but must be consistent).
  centerX: number;
  centerZ: number;

  /**
   * Radius in chunks from the center (Manhattan or square, server decides).
   * Example: radiusChunks = 3 => a 7x7 chunk area.
   */
  radiusChunks: number;

  /**
   * Highest allowed LOD level.
   *  - 0 = full res
   *  - 1+ = permit coarser LODs
   */
  maxLod: number;
}

/**
 * Stop all terrain streaming for this client.
 */
export interface TerrainUnsubscribeMessage
  extends ClientTerrainMessageEnvelope {
  kind: "terrain_unsubscribe";

  worldId: string;
}

/**
 * Update the streaming center point (e.g., player moved).
 * Server can choose to stream in/out chunks accordingly.
 */
export interface TerrainSetCenterMessage
  extends ClientTerrainMessageEnvelope {
  kind: "terrain_set_center";

  worldId: string;
  centerX: number;
  centerZ: number;
}

/**
 * Debug/inspection hook: ask the server to inspect terrain at a point.
 * Useful for dev tools or in-game diagnostics.
 */
export interface TerrainDebugInspectMessage
  extends ClientTerrainMessageEnvelope {
  kind: "terrain_debug_inspect";

  worldId: string;
  x: number;
  z: number;
}

// Union of all client→server terrain messages
export type ClientTerrainMessage =
  | TerrainSubscribeMessage
  | TerrainUnsubscribeMessage
  | TerrainSetCenterMessage
  | TerrainDebugInspectMessage;

// ---------------------------------------------------------------------------
// Server → Client terrain messages
// ---------------------------------------------------------------------------

export type ServerTerrainMessageKind =
  | "terrain_blueprint_meta"
  | "terrain_chunk_data"
  | "terrain_chunk_unload"
  | "terrain_resync";

/**
 * Base envelope for server→client terrain messages.
 */
export interface ServerTerrainMessageEnvelope {
  kind: ServerTerrainMessageKind;
}

/**
 * Sent once when subscription starts or resync is requested.
 * The client uses this to allocate buffers, set scaling, and sanity-check.
 */
export interface TerrainBlueprintMetaMessage
  extends ServerTerrainMessageEnvelope {
  kind: "terrain_blueprint_meta";

  meta: TerrainBlueprintMeta;
}

/**
 * Main chunk payload message.
 * Contains both the heightmap and optional 2.5D tile layer.
 */
export interface TerrainChunkDataMessage
  extends ServerTerrainMessageEnvelope {
  kind: "terrain_chunk_data";

  worldId: string;
  chunk: TerrainChunkDataWire;
}

/**
 * Instruct client to unload a chunk (e.g., moved out of range).
 */
export interface TerrainChunkUnloadMessage
  extends ServerTerrainMessageEnvelope {
  kind: "terrain_chunk_unload";

  worldId: string;
  id: TerrainChunkId;
}

/**
 * Ask client to discard *all* terrain state and resubscribe / re-init.
 * Used on shard restart or desync detection.
 */
export interface TerrainResyncMessage
  extends ServerTerrainMessageEnvelope {
  kind: "terrain_resync";

  worldId: string;
  reason: string;
  protocolVersion: number;
}

// Union of all server→client terrain messages
export type ServerTerrainMessage =
  | TerrainBlueprintMetaMessage
  | TerrainChunkDataMessage
  | TerrainChunkUnloadMessage
  | TerrainResyncMessage;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isClientTerrainMessage(
  msg: any
): msg is ClientTerrainMessage {
  if (!msg || typeof msg.kind !== "string") return false;

  switch (msg.kind) {
    case "terrain_subscribe":
    case "terrain_unsubscribe":
    case "terrain_set_center":
    case "terrain_debug_inspect":
      return true;
    default:
      return false;
  }
}

export function isServerTerrainMessage(
  msg: any
): msg is ServerTerrainMessage {
  if (!msg || typeof msg.kind !== "string") return false;

  switch (msg.kind) {
    case "terrain_blueprint_meta":
    case "terrain_chunk_data":
    case "terrain_chunk_unload":
    case "terrain_resync":
      return true;
    default:
      return false;
  }
}
