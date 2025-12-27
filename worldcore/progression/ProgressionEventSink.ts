// worldcore/progression/ProgressionEventSink.ts

import type { ProgressionEvent } from "./ProgressionCore";

export interface ProgressionEventSink {
  recordEvent(ev: ProgressionEvent & {
    userId: string;
    characterId: string;
    shardId?: string;
    roomId?: string;
    occurredAt: number;
  }): Promise<void>;
}
