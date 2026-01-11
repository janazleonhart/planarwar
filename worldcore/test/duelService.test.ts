// worldcore/test/duelService.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { DuelService } from "../pvp/DuelService";

test("DuelService: request -> accept creates active duel", () => {
  const svc = new DuelService();
  const now = 1_000;

  const req = svc.requestDuel("A", "Alice", "B", "Bob", "room1", now);
  assert.equal(req.ok, true);

  const accept = svc.acceptDuel("B", "A", "room1", now + 10);
  assert.equal(accept.ok, true);

  assert.equal(svc.isActiveBetween("A", "B"), true);
  assert.equal(svc.getOpponentId("A"), "B");
  assert.equal(svc.getOpponentId("B"), "A");
});

test("DuelService: decline removes pending request", () => {
  const svc = new DuelService();
  const now = 5_000;

  const req = svc.requestDuel("A", "Alice", "B", "Bob", "room1", now);
  assert.equal(req.ok, true);

  const dec = svc.declineDuel("B", "A", now + 1);
  assert.equal(dec.ok, true);

  const accept = svc.acceptDuel("B", "A", "room1", now + 2);
  assert.equal(accept.ok, false);
});

test("DuelService: expired requests cannot be accepted", () => {
  const svc = new DuelService();
  const now = 10_000;

  const req = svc.requestDuel("A", "Alice", "B", "Bob", "room1", now, 100);
  assert.equal(req.ok, true);

  // past expiry
  const accept = svc.acceptDuel("B", "A", "room1", now + 200);
  assert.equal(accept.ok, false);
});

test("DuelService: endDuelFor clears active duel", () => {
  const svc = new DuelService();
  const now = 20_000;

  svc.requestDuel("A", "Alice", "B", "Bob", "room1", now);
  const accept = svc.acceptDuel("B", "A", "room1", now + 1);
  assert.equal(accept.ok, true);

  const end = svc.endDuelFor("A", "yield", now + 2);
  assert.equal(end.ok, true);

  assert.equal(svc.isActiveBetween("A", "B"), false);
  assert.equal(svc.getActiveDuel("A"), null);
  assert.equal(svc.getActiveDuel("B"), null);
});
