// worldcore/test/contract_vendorHandleTargetsVendorId.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { handleVendorCommand } from "../mud/commands/economy/vendorCommand";

type AnyCtx = any;

function makeVendorDB() {
  const starter_alchemist = {
    id: "starter_alchemist",
    name: "Shard Alchemist",
    items: [
      { id: 1, itemId: "herb_peacebloom", priceGold: 1 },
      { id: 2, itemId: "ore_iron_hematite", priceGold: 2 },
    ],
  };

  return {
    starter_alchemist,
  } as Record<string, any>;
}

function makeCtx(opts: {
  roomId: string;
  playerPos: { x: number; z: number };
  roomEntities: any[];
  vendorDB: Record<string, any>;
}): AnyCtx {
  const session = { id: "sess1", roomId: opts.roomId, auth: { isDev: true } };

  // Player entity (used by handle resolution in vendorCommand).
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
    getItemDefinition: (itemId: string) => {
      if (itemId === "herb_peacebloom") return { id: itemId, name: "Peacebloom", rarity: "common" };
      if (itemId === "ore_iron_hematite") return { id: itemId, name: "Hematite Ore", rarity: "common" };
      return { id: itemId, name: itemId, rarity: "common" };
    },
  };

  const characters = {
    saveCharacter: async () => {},
  };

  // NOTE: requireTownService + vendorCommand both enforce vendor proximity when session+entities exist.
  // We keep the player on top of the vendor anchor in this test.
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

test("[contract] vendor handle targets the intended vendor (matches vendorId)", async () => {
  const vendorDB = makeVendorDB();
  const roomId = "prime_shard:0,0";

  // Vendor anchor NPC (handle base is derived from the *name*, so keep it stable).
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

  const ctx = makeCtx({
    roomId,
    playerPos: { x: 0, z: 0 },
    roomEntities: [alchemistNpc],
    vendorDB,
  });

  const char = makeChar(0, 0);

  const byId = await handleVendorCommand(ctx, char, ["list", "starter_alchemist"]);
  const byHandle = await handleVendorCommand(ctx, char, ["list", "alchemist.1"]);

  assert.equal(byHandle, byId);
  assert.match(byHandle, /Vendor:\s+Shard Alchemist\s+\(starter_alchemist\)/);
});
