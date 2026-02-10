// worldcore/test/contract_siegeCommand_showsTownState.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { handleSiegeCommand } from "../mud/commands/world/siegeCommand";
import { setRegionFlagsTestOverrides } from "../world/RegionFlags";
import { WorldEventBus } from "../world/WorldEventBus";
import { TownSiegeService } from "../world/TownSiegeService";

type AnyChar = any;

function makeChar(args: { id: string; name: string; shardId?: string; lastRegionId?: string }): AnyChar {
  return {
    id: args.id,
    name: args.name,
    shardId: args.shardId ?? "prime_shard",
    lastRegionId: args.lastRegionId ?? "1,0",
    level: 1,
    classId: "outrider",
    progression: { powerResources: {}, cooldowns: {}, skills: {} },
    spellbook: { known: {} },
    flags: {},
    statusEffects: {},
  };
}

test("[contract] siege: reports sanctuary + siege + breach + lockdown flags", async () => {
  // Mark the room as a sanctuary and opt-in to breach rules.
  setRegionFlagsTestOverrides({
    prime_shard: {
      "1,0": {
        rules: {
          ai: { townSanctuary: true, allowSiegeBreach: true },
          economy: { lockdownOnSiege: true },
          travel: { lockdownOnSiege: true },
        },
      },
    },
  });

  try {
    // Make breach easy to trigger in this contract.
    process.env.PW_TOWN_SANCTUARY_SIEGE_TTL_MS = "60000";
    process.env.PW_TOWN_SIEGE_BREACH_TTL_MS = "60000";
    process.env.PW_TOWN_SIEGE_BREACH_HITS = "1";
    process.env.PW_TOWN_SIEGE_BREACH_WINDOW_MS = "60000";

    const bus = new WorldEventBus();
    const siege = new TownSiegeService(bus);

    const roomId = "prime_shard:1,0";
    bus.emit("town.sanctuary.siege", {
      shardId: "prime_shard",
      roomId,
      pressureCount: 7,
      windowMs: 15000,
    });

    const char = makeChar({ id: "char_siege_1", name: "Watcher", shardId: "prime_shard", lastRegionId: "1,0" });
    const ctx: any = {
      session: { roomId },
      townSiege: siege,
    };

    const out = await handleSiegeCommand(ctx, char, { cmd: "siege", args: [], parts: ["siege"] } as any);
    const low = out.toLowerCase();

    assert.ok(low.includes("sanctuary: true"), `Expected sanctuary=true, got:\n${out}`);
    assert.ok(low.includes("allowSiegebreach=true".toLowerCase()), `Expected allowSiegeBreach=true, got:\n${out}`);
    assert.ok(low.includes("under siege: true"), `Expected underSiege=true, got:\n${out}`);
    assert.ok(low.includes("breach active: true"), `Expected breachActive=true, got:\n${out}`);
    assert.ok(low.includes("economy lockdown on siege: true"), `Expected economyLockdown=true, got:\n${out}`);
    assert.ok(low.includes("travel lockdown on siege: true"), `Expected travelLockdown=true, got:\n${out}`);
  } finally {
    setRegionFlagsTestOverrides(null);
  }
});
