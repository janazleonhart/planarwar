// worldcore/test/region_flags.test.ts

import assert from "node:assert/strict";
import test from "node:test";

import {
  RegionManager,
  type RegionDefinition,
} from "../world/RegionManager";

test("RegionManager basic flag helpers and room resolution", async () => {
  const regionManager = new RegionManager({
    entityManager: {} as any,
    roomManager: {} as any,
  });

  const regions: RegionDefinition[] = [
    {
      id: "prime_shard:0,0",
      name: "Starter Hub",
      zoneIds: ["prime_shard:0,0"],
      flags: {
        isSafeHub: true,
        isGraveyard: true,
      },
    },
    {
      id: "prime_shard:1,0",
      name: "Bandit Fields",
      zoneIds: ["prime_shard:1,0"],
      flags: {
        isLawless: true,
      },
    },
  ];

  await regionManager.initialize(regions);

  // 1) findRegionByRoom should resolve regions via zoneIds
  const hub = regionManager.findRegionByRoom("prime_shard:0,0");
  assert.ok(hub, "hub region should resolve from room");
  assert.equal(hub!.id, "prime_shard:0,0");

  const bandit = regionManager.findRegionByRoom("prime_shard:1,0");
  assert.ok(bandit, "bandit region should resolve from room");
  assert.equal(bandit!.id, "prime_shard:1,0");

  const missing = regionManager.findRegionByRoom("prime_shard:99,99");
  assert.equal(missing, undefined, "unknown room should not resolve a region");

  // 2) Flag helpers on the hub region
  assert.equal(
    regionManager.isSafeHubRegion(hub),
    true,
    "hub should be marked as safe hub",
  );
  assert.equal(
    regionManager.isGraveyardRegion(hub),
    true,
    "hub should be marked as graveyard",
  );
  assert.equal(
    regionManager.isLawlessRegion(hub),
    false,
    "hub should not be lawless",
  );

  // 3) Flag helpers on the lawless region
  assert.equal(
    regionManager.isLawlessRegion(bandit),
    true,
    "bandit fields should be lawless",
  );
  assert.equal(
    regionManager.isSafeHubRegion(bandit),
    false,
    "bandit fields should not be a safe hub",
  );
  assert.equal(
    regionManager.isGraveyardRegion(bandit),
    false,
    "bandit fields should not be a graveyard",
  );

  // 4) getFlagsForRoom should delegate to findRegionByRoom
  const hubFlags = regionManager.getFlagsForRoom("prime_shard:0,0");
  assert.deepEqual(
    hubFlags,
    {
      isSafeHub: true,
      isGraveyard: true,
    },
    "hub flags should reflect RegionDefinition.flags",
  );

  const banditFlags = regionManager.getFlagsForRoom("prime_shard:1,0");
  assert.deepEqual(
    banditFlags,
    {
      isLawless: true,
    },
    "bandit flags should reflect RegionDefinition.flags",
  );

  const noFlags = regionManager.getFlagsForRoom("prime_shard:9,9");
  assert.equal(
    noFlags,
    undefined,
    "rooms without regions should have no flags",
  );
});
