// worldcore/test/contract_petSummon_spellTiers.test.ts
//
// Contract: summon_pet spells support tier gating, resummon replacement,
// and deny-path ordering (no cost/cooldown when cast is denied).

import test from "node:test";
import assert from "node:assert/strict";

import { castSpellForCharacter } from "../mud/MudSpells";
import { SPELLS } from "../spells/SpellTypes";
import { setRegionFlagsTestOverrides } from "../world/RegionFlags";

type AnyChar = any;

function makeChar(args: { id: string; name: string; classId: string; level: number }): AnyChar {
  return {
    id: args.id,
    name: args.name,
    classId: args.classId,
    level: args.level,
    shardId: "prime_shard",
    hp: 100,
    maxHp: 100,
    gold: 0,
    // Minimal resources/cooldowns to let MudSpells gates run.
    resources: { mana: { kind: "mana", cur: 50, max: 50 } },
    cooldowns: {},
    spellbook: { knownSpellIds: {}, knownAbilityIds: {}, knownSongIds: {} },
    statusEffects: { active: {} },
  };
}

function makeEntities(roomId: string, sessionId: string) {
  const list: any[] = [];
  const byId = new Map<string, any>();

  const player = { id: "player.1", type: "player", ownerId: sessionId, roomId, name: "Player" };
  list.push(player);
  byId.set(player.id, player);

  return {
    getAll() {
      return list.slice();
    },
    getEntitiesInRoom(rid: string) {
      return list.filter((e) => String(e.roomId) === rid);
    },
    getEntityByOwner(ownerId: string) {
      return list.find((e) => e.type === "player" && String(e.ownerId) === String(ownerId));
    },
    getPetByOwnerEntityId(ownerEntityId: string) {
      return list.find((e) => e.type === "pet" && String(e.ownerEntityId) === String(ownerEntityId));
    },
    createPetEntity(rid: string, model: string, ownerEntityId: string) {
      const id = `pet.${Math.random().toString(16).slice(2)}`;
      const pet = {
        id,
        type: "pet",
        roomId: rid,
        model,
        name: model,
        ownerEntityId,
        hp: 1,
        maxHp: 1,
        petMode: "defensive",
        followOwner: true,
      };
      list.push(pet);
      byId.set(id, pet);
      return pet;
    },
    removeEntity(id: string) {
      const idx = list.findIndex((e) => String(e.id) === String(id));
      if (idx >= 0) list.splice(idx, 1);
      byId.delete(String(id));
    },
    getById(id: string) {
      return byId.get(String(id));
    },
  };
}

function makeCtx(roomId: string, sessionId: string, entities: any) {
  const rooms = {
    getOrCreateRoom(_shard: string, rid: string) {
      return { id: rid, shardId: "prime_shard" };
    },
  };

  const sessions = {
    getSessionById(id: string) {
      return id === sessionId ? { id: sessionId, characterId: "char.1" } : null;
    },
  };

  // NpcManager isn't used by summon_pet, but MudSpells expects ctx.npcs to exist in some paths.
  const npcs = {
    recordDamage() {},
  };

  return {
    shardId: "prime_shard",
    world: { shardId: "prime_shard" },
    session: { id: sessionId },
    entities,
    rooms,
    sessions,
    npcs,
    broadcast: { broadcast() {} },
  } as any;
}

test("[contract] summon_pet: tier gating by level denies before cost/cooldown", async () => {
  const roomId = "prime_shard:0,0";
  const sessionId = "sess.pet.tiers";
  const entities = makeEntities(roomId, sessionId);
  const ctx = makeCtx(roomId, sessionId, entities);

  const low = makeChar({ id: "char.1", name: "Low", classId: "magician", level: 1 });
  const spell = (SPELLS as any).magician_summon_wolf_ii;
  assert.ok(spell, "expected magician_summon_wolf_ii to exist in SPELLS");

  const manaBefore = low.resources.mana.cur;
  const out = await castSpellForCharacter(ctx, low, spell, "");
  assert.ok(String(out).toLowerCase().includes("level"), `expected level denial, got: ${out}`);
  assert.equal(low.resources.mana.cur, manaBefore, "deny must not spend mana");
  assert.equal(Object.keys(low.cooldowns ?? {}).length, 0, "deny must not start cooldowns");
  assert.equal(entities.getAll().filter((e: any) => e.type === "pet").length, 0, "deny must not summon a pet");
});

test("[contract] summon_pet: resummon replaces existing pet (single active pet)", async () => {
  const roomId = "prime_shard:0,0";
  const sessionId = "sess.pet.resummon";
  const entities = makeEntities(roomId, sessionId);
  const ctx = makeCtx(roomId, sessionId, entities);

  const char = makeChar({ id: "char.1", name: "Summoner", classId: "hunter", level: 20 });

  const s1 = (SPELLS as any).hunter_call_wolf_i;
  const s2 = (SPELLS as any).hunter_call_wolf_ii;
  assert.ok(s1 && s2, "expected hunter_call_wolf_i and hunter_call_wolf_ii");

  const out1 = await castSpellForCharacter(ctx, char, s1, "");
  assert.ok(String(out1).toLowerCase().includes("summon"), `expected summon line, got: ${out1}`);
  const pets1 = entities.getAll().filter((e: any) => e.type === "pet");
  assert.equal(pets1.length, 1, "after first summon, should have 1 pet");
  const pet1 = pets1[0];

  const out2 = await castSpellForCharacter(ctx, char, s2, "");
  assert.ok(String(out2).toLowerCase().includes("summon"), `expected summon line, got: ${out2}`);
  const pets2 = entities.getAll().filter((e: any) => e.type === "pet");
  assert.equal(pets2.length, 1, "after resummon, should still have 1 pet");
  const pet2 = pets2[0];

  assert.notEqual(String(pet1.id), String(pet2.id), "resummon should replace pet entity id");
  assert.equal(String(pet2.model), "pet_wolf_alpha", "tier II should summon the stronger model");
});

test("[contract] summon_pet: deny path (combat disabled) blocks before cost/cooldown + no pet spawn", async () => {
  const roomId = "prime_shard:9,9";
  const sessionId = "sess.pet.deny";
  const entities = makeEntities(roomId, sessionId);
  const ctx = makeCtx(roomId, sessionId, entities);

  // Disable combat in this region/room.
  setRegionFlagsTestOverrides({
    prime_shard: {
      "9,9": { combatEnabled: false },
    },
  });

  const char = makeChar({ id: "char.1", name: "Denied", classId: "magician", level: 20 });
  const spell = (SPELLS as any).magician_summon_wolf_i;

  const manaBefore = char.resources.mana.cur;
  const out = await castSpellForCharacter(ctx, char, spell, "");
  assert.ok(String(out).toLowerCase().includes("disabled"), `expected combat-disabled denial, got: ${out}`);
  assert.equal(char.resources.mana.cur, manaBefore, "deny must not spend mana");
  assert.equal(Object.keys(char.cooldowns ?? {}).length, 0, "deny must not start cooldowns");
  assert.equal(entities.getAll().filter((e: any) => e.type === "pet").length, 0, "deny must not summon a pet");

  // cleanup override for other tests
  setRegionFlagsTestOverrides(null);
});
