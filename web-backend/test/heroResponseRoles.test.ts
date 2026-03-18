//web-backend/test/heroResponseRoles.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  getOrCreatePlayerState,
  recruitHeroForPlayer,
  regenerateRegionMissionsForPlayer,
  startMissionForPlayer,
  completeMissionForPlayer,
} from "../gameState";

function withRandomSequence<T>(values: number[], fn: () => T): T {
  const original = Math.random;
  let index = 0;
  Math.random = () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0.5;
    index += 1;
    return value;
  };
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

test("recruited heroes receive response roles and pros/cons traits", () => {
  const ps = getOrCreatePlayerState("hero_traits_player");

  const result = withRandomSequence([0.4], () =>
    recruitHeroForPlayer("hero_traits_player", "scout", new Date("2026-03-17T10:00:00Z")),
  );

  assert.equal(result.status, "ok");
  assert.ok(result.hero);
  assert.deepEqual(result.hero?.responseRoles, ["recon", "recovery"]);
  assert.equal(result.hero?.traits.length, 2);
  assert.equal(result.hero?.traits.some((trait) => trait.polarity === "pro"), true);
  assert.equal(result.hero?.traits.some((trait) => trait.polarity === "con"), true);
});

test("assigned hero changes outcome for matching response lanes", () => {
  const ps = getOrCreatePlayerState("hero_assignment_player");
  const now = new Date("2026-03-17T12:00:00Z");

  ps.heroes = [
    {
      id: "hero_bad",
      ownerId: ps.playerId,
      name: "Bulwark Dorn",
      role: "champion",
      responseRoles: ["frontline", "recovery"],
      traits: [
        { id: "rigid", name: "Rigid", polarity: "con", summary: "Poor at recon work.", responseBias: { recon: -14 } },
      ],
      power: 74,
      tags: [],
      status: "idle",
    },
    {
      id: "hero_good",
      ownerId: ps.playerId,
      name: "Mist Lyra",
      role: "scout",
      responseRoles: ["recon", "recovery"],
      traits: [
        { id: "swift", name: "Swift", polarity: "pro", summary: "Excellent at recon.", responseBias: { recon: 18 } },
      ],
      power: 74,
      tags: [],
      status: "idle",
      attachments: [{ id: "a1", name: "Scouting Cloak", kind: "scouting_cloak" }],
    },
  ] as any;

  const offers = regenerateRegionMissionsForPlayer(ps.playerId, ps.city.regionId as any, now) ?? [];
  const reconMission = offers.find((offer) => offer.kind === "hero" && offer.responseTags.includes("recon"));
  assert.ok(reconMission, "expected a recon-tagged hero mission");

  const activeBad = startMissionForPlayer(ps.playerId, reconMission!.id, now, "hero_bad");
  assert.ok(activeBad);
  activeBad!.finishesAt = now.toISOString();

  const badOutcome = withRandomSequence([0.72, 0.15], () =>
    completeMissionForPlayer(ps.playerId, activeBad!.instanceId, now),
  );
  assert.equal(badOutcome.status, "ok");
  assert.ok((badOutcome.outcome?.successChance ?? 0) > 0);

  reconMission!.id = `${reconMission!.id}_retry`;
  ps.currentOffers.push(reconMission!);
  const activeGood = startMissionForPlayer(ps.playerId, reconMission!.id, now, "hero_good");
  assert.ok(activeGood);
  activeGood!.finishesAt = now.toISOString();

  const goodOutcome = withRandomSequence([0.6, 0.15], () =>
    completeMissionForPlayer(ps.playerId, activeGood!.instanceId, now),
  );
  assert.equal(goodOutcome.status, "ok");
  assert.ok((goodOutcome.outcome?.successChance ?? 0) > (badOutcome.outcome?.successChance ?? 0), "matching response roles should improve the mission odds");
  assert.notEqual(goodOutcome.outcome?.kind, "failure");
});
