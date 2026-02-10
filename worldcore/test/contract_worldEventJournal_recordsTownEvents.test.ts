// worldcore/test/contract_worldEventJournal_recordsTownEvents.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { WorldEventBus } from "../world/WorldEventBus";
import { WorldEventJournalService } from "../world/WorldEventJournalService";

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

test("[contract] WorldEventJournal: records town.* events and enforces ring buffer cap", () => {
  withEnv({ PW_WORLD_EVENT_JOURNAL_MAX: "3" }, () => {
    const bus = new WorldEventBus();
    const journal = new WorldEventJournalService(bus);

    const baseTs = Date.now();

    // Emit 4 town events; cap=3 so the first should be evicted.
    bus.emit("town.sanctuary.siege", {
      shardId: "prime_shard",
      roomId: "prime_shard:0,0",
      pressureCount: 12,
      windowMs: 15000,
    });

    bus.emit("town.sanctuary.breach", {
      shardId: "prime_shard",
      roomId: "prime_shard:0,0",
      breachUntilTs: baseTs + 9999,
    });

    bus.emit("town.sanctuary.siege", {
      shardId: "prime_shard",
      roomId: "prime_shard:1,0",
      pressureCount: 13,
      windowMs: 15000,
    });

    bus.emit("town.sanctuary.breach", {
      shardId: "prime_shard",
      roomId: "prime_shard:1,0",
      breachUntilTs: baseTs + 8888,
    });

    const recent = journal.peekRecent({ eventPrefix: "town.", limit: 10 });

    assert.equal(recent.length, 3, "should retain only max records");
    assert.equal(recent[0].event, "town.sanctuary.breach");
    assert.equal((recent[0].payload as any).roomId, "prime_shard:1,0");

    // Oldest of the retained set should be the 2nd emitted event (breach on 0,0)
    assert.equal(recent[2].event, "town.sanctuary.breach");
    assert.equal((recent[2].payload as any).roomId, "prime_shard:0,0");

    // Ensure the very first event (siege on 0,0) was evicted by the ring buffer.
    assert.equal(
      recent.some((r) => r.event === "town.sanctuary.siege" && (r.payload as any).roomId === "prime_shard:0,0"),
      false,
      "oldest record should be evicted",
    );
  });
});
