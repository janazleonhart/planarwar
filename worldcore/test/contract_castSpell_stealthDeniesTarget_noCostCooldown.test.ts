// worldcore/test/contract_castSpell_stealthDeniesTarget_noCostCooldown.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import { castSpellForCharacter } from "../mud/MudSpells";
import { SPELLS } from "../spells/SpellTypes";
import { applyStatusEffectToEntity } from "../combat/StatusEffects";

type AnyObj = Record<string, any>;

function makeCtx(roomId: string) {
  const sessionA: AnyObj = { id: "sess_a", roomId, character: { name: "Caster", mp: 100, spellbook: { known: {}, cooldowns: {} } } };
  const sessionB: AnyObj = { id: "sess_b", roomId, character: { name: "Sneaky" } };

  const casterEnt: AnyObj = { id: "ent_a", type: "player", name: "Caster", roomId, ownerSessionId: sessionA.id, hp: 100, alive: true };
  const stealthEnt: AnyObj = { id: "ent_b", type: "player", name: "Sneaky", roomId, ownerSessionId: sessionB.id, hp: 100, alive: true };
  const entities = [casterEnt, stealthEnt];

  const entitiesMgr: AnyObj = {
    getAll: () => entities,
    getEntityByOwner: (ownerSessionId: string) => entities.find((e) => e.ownerSessionId === ownerSessionId) ?? null,
    getEntitiesInRoom: (rid: string) => entities.filter((e) => String(e.roomId) === String(rid)),
  };

  const sessionsById = new Map<string, AnyObj>([[sessionA.id, sessionA],[sessionB.id, sessionB]]);
  const sessions: AnyObj = {
    sendToSession: () => {},
    sendToRoomExcept: () => {},
    broadcastToRoom: () => {},
    getSessionById: (id: string) => sessionsById.get(id) ?? null,
    getAllSessions: () => Array.from(sessionsById.values()),
  };

  return { session: sessionA, sessions, guilds: {}, entities: entitiesMgr, nowMs: 1234 };
}

function snapshot(obj: any) {
  return JSON.parse(JSON.stringify(obj ?? {}));
}

test("[contract] castSpell: stealthed player cannot be targeted and does not consume cost/cooldowns", async () => {
  const roomId = "prime_shard:0,0";
  const ctx: AnyObj = makeCtx(roomId);
  const now = Number(ctx.nowMs);

  const spell: AnyObj = (SPELLS as any).mage_fire_bolt ?? Object.values(SPELLS as any)[0];
  assert.ok(spell?.id, "Expected at least one spell to exist for this test");

  const char: AnyObj = ctx.session.character;
  char.spellbook.known[spell.id] = true;

  const targetEntity = ctx.entities.getEntityByOwner("sess_b");
  assert.ok(targetEntity, "Expected target entity to exist");
  applyStatusEffectToEntity(targetEntity, { id: "test_stealth", name: "Stealth", tags: ["stealth"], durationMs: 60_000, modifiers: {} }, now);

  const before = snapshot(char);
  const msg = await castSpellForCharacter(ctx as any, char as any, spell as any, "Sneaky");
  assert.match(String(msg), /cannot see/i);
  assert.deepEqual(char.spellbook.cooldowns, before.spellbook.cooldowns);
  assert.equal(char.mp, before.mp);
});