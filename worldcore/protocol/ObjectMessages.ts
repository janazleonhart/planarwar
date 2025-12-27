//worldcore/protocol/ObjectMessages.ts

// Shared object streaming message types for Planar War.
//
// These are used by the MMO backend (ObjectStream) and are intended
// to also be imported by clients (3D, 2.5D web, MUD) so everyone
// agrees on the shape of static world data.

import type {
    BlueprintObject,
    SpawnPoint,
  } from "../shards/WorldBlueprint";
  
  /**
   * Client → Server
   * Ask the server for static world objects / spawns for the current shard.
   *
   * For v1, the payload is optional and the server just returns all objects
   * for the primary shard; later we can add paging, filters, region IDs, etc.
   */
  export interface ClientObjectRequestPayload {
    /**
     * Optional shard identifier. If omitted, the server uses the current
     * room’s shard or the default shard.
     */
    shardId?: string;
  
    /**
     * Optional region or chunk hint, for future paging / spatial filters.
     * Not used by v1 ObjectStream.
     */
    regionId?: string;
  }
  
  /**
   * Server → Client
   * Static world objects and spawn points for a shard slice.
   *
   * For v1, this is sent as a single chunk when the client issues
   * an "object_request" op. Later we can send multiple chunks
   * with done=false followed by a final done=true.
   */
  export interface ObjectChunkPayload {
    shardId: string;
  
    /**
     * Static objects from the world blueprint.
     * These are not dynamic entities and do not move.
     */
    objects: BlueprintObject[];
  
    /**
     * Spawn points (towns, dungeons, POIs, etc.) from the world blueprint.
     */
    spawns: SpawnPoint[];
  
    /**
     * True when this is the last (or only) chunk.
     * Future versions may send many chunks with done=false and a final done=true.
     */
    done: boolean;
  }
  