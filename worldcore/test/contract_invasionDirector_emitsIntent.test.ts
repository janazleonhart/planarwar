// worldcore/test/contract_invasionDirector_emitsIntent.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { WorldEventBus } from "../world/WorldEventBus";
import { TownSiegeService } from "../world/TownSiegeService";
import { WorldEventJournalService } from "../world/WorldEventJournalService";
import { InvasionDirectorService } from "../world/InvasionDirectorService";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete (process.env as any)[k];
    else (process.env as any)[k] = v;
  }

  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete (process.env as any)[k];
      else (process.env as any)[k] = v;
    }
  }
}

test("[contract] InvasionDirector: breach emits town.invasion.intent once per cooldown", () => {
  withEnv(
    {
      PW_WORLD_EVENT_JOURNAL_MAX: "50",
      PW_TOWN_INVASION_INTENT_COOLDOWN_MS: "60000",
    },
    () => {
      const events = new WorldEventBus();
      const journal = new WorldEventJournalService(events);
      const siege = new TownSiegeService(events);
      const director = new InvasionDirectorService(events, siege);
      void director;

      const roomId = "prime_shard:0,0";
      const shardId = "prime_shard";

      const realNow = Date.now;
      try {
        let now = 1_000_000;
        // Deterministic time so cooldown behavior is stable.
        (Date as any).now = () => now;

        events.emit("town.sanctuary.breach", { shardId, roomId, breachUntilTs: now + 10_000 });
        now += 1;
        events.emit("town.sanctuary.breach", { shardId, roomId, breachUntilTs: now + 10_000 });

        const recs = journal.peekRecent({ events: ["town.invasion.intent"], limit: 10 });
        assert.equal(recs.length, 1, "should emit only one intent within cooldown window");

        const payload: any = recs[0].payload;
        assert.equal(recs[0].event, "town.invasion.intent");
        assert.equal(payload.shardId, shardId);
        assert.equal(payload.roomId, roomId);
        assert.equal(payload.reason, "breach");
      } finally {
        (Date as any).now = realNow;
      }
    },
  );
});
