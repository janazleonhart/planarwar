// worldcore/characters/CharacterService.ts

import {
    CharacterId,
    ShardId,
    UserId,
    CharacterSummary,
  } from "../shared/AuthTypes";
  import { CharacterState } from "./CharacterTypes";
  
  export interface CreateCharacterParams {
    shardId: ShardId;
    name: string;
    classId: string;
  }
  
  /**
   * CharacterService – API for managing characters.
   *
   * This is backend-agnostic; MMO shard, webend, and tools can all
   * depend on this interface without caring it's Postgres under the hood.
   */
  export interface CharacterService {
    listCharactersForUser(userId: UserId): Promise<CharacterSummary[]>;
  
    createCharacter(
      userId: UserId,
      params: CreateCharacterParams
    ): Promise<CharacterState>;
  
    loadCharacter(
      charId: CharacterId
    ): Promise<CharacterState | null>;
  
    saveCharacter(state: CharacterState): Promise<void>;
  }
  