// worldcore/test/contract_melodyScheduler.test.ts
//
// Contract tests for MelodyScheduler (pure melody state machine).
// Uses node:test like the rest of the suite.

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MELODY_INTERVAL_MS,
  normalizeMelody,
  getPlaylist,
  currentSpellId,
  advanceAndSchedule,
} from "../songs/MelodyScheduler";

test("[contract] MelodyScheduler normalizes legacy songIds into spellIds and mirrors keys", () => {
  const m = normalizeMelody({
    songIds: ["rising_courage", "woven_recovery"],
    isActive: true,
    currentIndex: 0,
    nextCastAtMs: 0,
  });

  assert.deepEqual(m.spellIds, ["rising_courage", "woven_recovery"]);
  assert.deepEqual(m.songIds, ["rising_courage", "woven_recovery"]);
  assert.equal(m.intervalMs, DEFAULT_MELODY_INTERVAL_MS);
});

test("[contract] MelodyScheduler clamps index and returns current id safely", () => {
  const m = normalizeMelody({
    spellIds: ["a", "b"],
    isActive: true,
    currentIndex: 999,
    nextCastAtMs: 0,
    intervalMs: 1234,
  });

  const playlist = getPlaylist(m);
  const id = currentSpellId(m, playlist);

  assert.equal(id, "a", "Out-of-range index should clamp to 0");
  assert.equal(m.currentIndex, 0, "Index should be clamped in-state");
});

test("[contract] MelodyScheduler always advances index and schedules next cast", () => {
  const m = normalizeMelody({
    spellIds: ["a", "b"],
    isActive: true,
    currentIndex: 0,
    nextCastAtMs: 0,
    intervalMs: 8000,
  });

  const playlist = getPlaylist(m);

  advanceAndSchedule(m, playlist, 10_000);

  assert.equal(m.currentIndex, 1, "Index should advance from 0 → 1");
  assert.equal(m.nextCastAtMs, 18_000, "nextCastAtMs should schedule now+interval");
  assert.deepEqual(m.spellIds, ["a", "b"], "Playlist should remain mirrored");
  assert.deepEqual(m.songIds, ["a", "b"], "Legacy key should remain mirrored");
});

test("[contract] MelodyScheduler wraps index and still schedules when playlist is empty", () => {
  const m = normalizeMelody({
    spellIds: ["a", "b"],
    isActive: true,
    currentIndex: 1,
    nextCastAtMs: 0,
    intervalMs: 5000,
  });

  const playlist = getPlaylist(m);

  // advance from index 1 → wrap to 0
  advanceAndSchedule(m, playlist, 1_000);
  assert.equal(m.currentIndex, 0);
  assert.equal(m.nextCastAtMs, 6_000);

  // empty playlist: stay at 0, still schedule
  advanceAndSchedule(m, [], 2_000);
  assert.equal(m.currentIndex, 0);
  assert.equal(m.nextCastAtMs, 7_000);
});
