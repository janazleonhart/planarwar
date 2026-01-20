// worldcore/test/contract_vendorListInfersNearestVendor.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { handleVendorCommand } from "../mud/commands/economy/vendorCommand";

type AnyCtx = any;

function makeVendorDB() {
  const starter_alchemist = {
    id: "starter_alchemist",
    name: "Shard Alchemist",
    items: [{ id: 1, itemId: "herb_peacebloom", priceGold: 1 }],
  };

  const starter_blacksmith = {
    id: "starter_blacksmith",
    name: "Town Blacksmith",
    items: [{ id: 1, itemId: "ore_iron_hematite", priceGold: 2 }],
  };

  return {
    starter_alchemist,
    starter_blacksmith,
  } as Record<string, any>;
}

function makeCtx(opts: {
  roomId: string;
  playerPos: { x: number; z: number };
  roomEntities: any[];
  vendorDB: Record<string, any>;
}): AnyCtx {
  const session = { id: "sess1", roomId: opts.roomId, auth: { isDev: true } };

  const playerEntity = {
    id: "player_ent",
    type: "player",
    ownerSessionId: session.id,
    x: opts.playerPos.x,
    z: opts.playerPos.z,
    name: "Player",
  };

  const entitiesInRoom = [playerEntity, ...opts.roomEntities];

  const entities = {
    getEntitiesInRoom: (rid: string) => (rid === opts.roomId ? entitiesInRoom : []),
    getEntityByOwner: (sid: string) => (sid === session.id ? playerEntity : null),
  };

  const vendors = {
    listVendors: async () =>
      Object.values(opts.vendorDB).map((v: any) => ({ id: v.id, name: v.name })),
    getVendor: async (id: string) => opts.vendorDB[id] ?? null,
  };

  const items = {
    getItemDefinition: (itemId: string) => ({ id: itemId, name: itemId, rarity: "common" }),
  };

  const characters = { saveCharacter: async () => {} };

  return { session, entities, vendors, items, characters } as AnyCtx;
}

function makeChar(x: number, z: number): any {
  return {
    id: "char1",
    pos: { x, y: 0, z },
    progression: {},
    gold: 0,
    bags: [],
    inventory: [],
  };
}

test("[contract] vendor list (no args) infers the nearest vendor anchor", async () => {
  const vendorDB = makeVendorDB();
  const roomId = "prime_shard:0,0";

  const alchemistNpc = {
    id: "npc_alchemist_1",
    type: "npc",
    name: "Shard Alchemist",
    spawnPointId: 101,
    protoId: "starter_alchemist",
    templateId: "starter_alchemist",
    x: 0,
    z: 0,
    alive: true,
    tags: ["protected_service", "service_vendor", "vendor", "merchant", "town"],
  };

  const blacksmithNpc = {
    id: "npc_blacksmith_1",
    type: "npc",
    name: "Town Blacksmith",
    spawnPointId: 102,
    protoId: "starter_blacksmith",
    templateId: "starter_blacksmith",
    x: 25,
    z: 0,
    alive: true,
    tags: ["protected_service", "service_vendor", "vendor", "merchant", "town"],
  };

  const ctx = makeCtx({
    roomId,
    playerPos: { x: 0, z: 0 },
    roomEntities: [alchemistNpc, blacksmithNpc],
    vendorDB,
  });

  const char = makeChar(0, 0);

  const inferred = await handleVendorCommand(ctx, char, ["list"]);
  const explicitHandle = await handleVendorCommand(ctx, char, ["list", "alchemist.1"]);
  const explicitId = await handleVendorCommand(ctx, char, ["list", "starter_alchemist"]);

  assert.equal(inferred, explicitHandle);
  assert.equal(inferred, explicitId);
  assert.match(inferred, /Vendor:\s+Shard Alchemist\s+\(starter_alchemist\)/);
});
