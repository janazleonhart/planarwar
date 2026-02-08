// worldcore/test/contract_castSpell_engageStateLawDenies_noCostCooldown.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import { castSpellForCharacter } from "../mud/MudSpells";
import { SPELLS } from "../spells/SpellTypes";

type AnyObj = Record<string, any>;

function snapshot(obj: any) {
  return JSON.parse(JSON.stringify(obj ?? {}));
}

function makeCtx(opts: { casterRoomId: string; targetRoomId: string }) {
  const { casterRoomId, targetRoomId } = opts;

  const sessionA: AnyObj = {
    id: "sess_a",
    roomId: casterRoomId,
    character: { name: "Caster", mp: 100, spellbook: { known: {}, cooldowns: {} } },
  };

  const sessionB: AnyObj = {
    id: "sess_b",
    roomId: targetRoomId,
    character: { name: "Target" },
  };

  const casterEnt: AnyObj = {
    id: "ent_a",
    type: "player",
    name: "Caster",
    roomId: casterRoomId,
    ownerSessionId: sessionA.id,
    hp: 100,
    alive: true,
  };

  const targetEnt: AnyObj = {
    id: "ent_b",
    type: "player",
    name: "Target",
    roomId: targetRoomId,
    ownerSessionId: sessionB.id,
    hp: 100,
    alive: true,
  };

  const entities = [casterEnt, targetEnt];

  const entitiesMgr: AnyObj = {
    getAll: () => entities,
    getEntityByOwner: (ownerSessionId: string) =>
      entities.find((e) => e.ownerSessionId === ownerSessionId) ?? null,
    getEntitiesInRoom: (rid: string) => entities.filter((e) => String(e.roomId) === String(rid)),
  };

  const sessionsById = new Map<string, AnyObj>([
    [sessionA.id, sessionA],
    [sessionB.id, sessionB],
  ]);

  const sessions: AnyObj = {
    sendToSession: () => {},
    sendToRoomExcept: () => {},
    broadcastToRoom: () => {},
    getSessionById: (id: string) => sessionsById.get(id) ?? null,
    getAllSessions: () => Array.from(sessionsById.values()),
  };

  return { session: sessionA, sessions, guilds: {}, entities: entitiesMgr, nowMs: 1000 };
}

function pickTestSpell(): AnyObj {
  // Any direct-damage spell works; Engage State Law checks happen before cost/cd.
  const spell: AnyObj = (SPELLS as any).mage_fire_bolt ?? Object.values(SPELLS as any)[0];
  assert.ok(spell?.id, "Expected at least one spell to exist for this test");
  return spell;
}

test("[contract] castSpell: Engage State Law denies are side-effect free (no cost/cooldown)", async () => {
  const spell = pickTestSpell();

  // 1) out_of_room
  {
    const ctx: AnyObj = makeCtx({ casterRoomId: "prime_shard:0,0", targetRoomId: "prime_shard:1,0" });
    const char: AnyObj = ctx.session.character;
    char.spellbook.known[spell.id] = true;

    const before = snapshot(char);
    const msg = await castSpellForCharacter(ctx as any, char as any, spell as any, "Target");
    assert.match(String(msg), /no such target|not here|not.*here|not in this room/i);
    assert.deepEqual(char.spellbook.cooldowns, before.spellbook.cooldowns);
    assert.equal(char.mp, before.mp);
  }

  // 2) protected
  {
    const ctx: AnyObj = makeCtx({ casterRoomId: "prime_shard:0,0", targetRoomId: "prime_shard:0,0" });
    const char: AnyObj = ctx.session.character;
    char.spellbook.known[spell.id] = true;

    const targetEntity = ctx.entities.getEntityByOwner("sess_b");
    assert.ok(targetEntity, "Expected target entity to exist");
    targetEntity.isProtectedService = true;

    const before = snapshot(char);
    const msg = await castSpellForCharacter(ctx as any, char as any, spell as any, "Target");
    assert.match(String(msg), /protected|cannot be harmed|city law/i);
    assert.deepEqual(char.spellbook.cooldowns, before.spellbook.cooldowns);
    assert.equal(char.mp, before.mp);
  }

  // 3) dead
  {
    const ctx: AnyObj = makeCtx({ casterRoomId: "prime_shard:0,0", targetRoomId: "prime_shard:0,0" });
    const char: AnyObj = ctx.session.character;
    char.spellbook.known[spell.id] = true;

    const targetEntity = ctx.entities.getEntityByOwner("sess_b");
    assert.ok(targetEntity, "Expected target entity to exist");
    targetEntity.alive = false;
    targetEntity.hp = 0;

    const before = snapshot(char);
    const msg = await castSpellForCharacter(ctx as any, char as any, spell as any, "Target");
    assert.match(String(msg), /dead/i);
    assert.deepEqual(char.spellbook.cooldowns, before.spellbook.cooldowns);
    assert.equal(char.mp, before.mp);
  }
});
