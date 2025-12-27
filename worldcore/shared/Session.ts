//worldcore/shared/Session.ts

import { WebSocket } from "ws";
import { AttachedIdentity } from "./AuthTypes";
import { CharacterState } from "../characters/CharacterTypes";

export interface Session {
  id: string;
  displayName: string;
  socket: WebSocket;
  roomId: string | null;
  lastSeen: number;
  shardId?: string; // e.g. "prime_shard"
  identity?: AttachedIdentity;
  character?: CharacterState;
}
