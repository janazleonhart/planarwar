//web-backend/test/publicInfrastructure.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { createInitialPublicInfrastructureState, quotePublicServiceUsage } from "../domain/publicInfrastructure";
import { getOrCreatePlayerState } from "../gameState";
import { withInfrastructureRollback } from "../routes/publicInfrastructureSupport";

function makePlayer() {
  const ps = getOrCreatePlayerState(`pubinfra_${Date.now()}_${Math.floor(Math.random() * 100000)}`);
  ps.publicInfrastructure = createInitialPublicInfrastructureState("2026-03-16T00:00:00.000Z");
  return ps;
}

test("npc public infrastructure quote applies novice subsidy and queue strain", () => {
  const ps = makePlayer();
  ps.cityStress.stage = "strained";
  ps.cityStress.total = 42;
  const quote = quotePublicServiceUsage(
    ps,
    "workshop_craft",
    { materials: 80, wealth: 24, mana: 10 },
    "npc_public"
  );

  assert.equal(quote.mode, "npc_public");
  assert.equal(quote.permitTier, "novice");
  assert.ok((quote.levy.materials ?? 0) > 0);
  assert.ok((quote.levy.wealth ?? 0) > 0);
  assert.ok(quote.queueMinutes >= 8);
  assert.match(quote.note, /Novice civic subsidy/i);
});

test("public infrastructure rollback restores player state when levy validation fails", () => {
  const ps = makePlayer();
  ps.resources.wealth = 10;
  const beforeWealth = ps.resources.wealth;
  const beforeHeroCount = ps.heroes.length;

  const wrapped = withInfrastructureRollback(
    ps,
    () => {
      ps.resources.wealth = 0;
      ps.heroes.push({
        id: "hero_test",
        ownerId: ps.playerId,
        name: "Test Hero",
        role: "champion",
        power: 99,
        tags: [],
        status: "idle",
      });
      return { ok: true };
    },
    () => ({ ok: false as const, error: "levy blocked" })
  );

  assert.equal(wrapped.ok, false);
  assert.equal(ps.resources.wealth, beforeWealth);
  assert.equal(ps.heroes.length, beforeHeroCount);
});
