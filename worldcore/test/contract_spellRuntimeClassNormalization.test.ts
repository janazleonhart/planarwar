//worldcore/test/contract_spellRuntimeClassNormalization.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { castSpellForCharacter, listKnownSpellsForChar } from "../mud/MudSpells";

type AnyObj = any;

const TEST_CLASS_SPELL: AnyObj = {
  id: "ascetic_test_bolt",
  name: "Ascetic Test Bolt",
  kind: "damage_single_npc",
  minLevel: 1,
  classId: "ascetic",
  isDebug: true,
  damageMin: 5,
  damageMax: 5,
  resourceCost: 0,
  cooldownMs: 0,
};

function makeChar(classId: string): AnyObj {
  return {
    id: "char_prefixed",
    userId: "u1",
    shardId: "prime_shard",
    name: "Prefixed",
    classId,
    level: 1,
    spellbook: { known: {} },
    progression: { powerResources: { chi: { current: 10, max: 100 } }, cooldowns: {}, skills: {} },
    flags: {},
    statusEffects: {},
    attributes: {},
  };
}

function makeCtx(char: AnyObj): AnyObj {
  const roomId = "prime_shard:0,0";
  const session = { id: "sess_prefixed", roomId, character: char };
  const npc = {
    id: "npc_dummy",
    type: "npc",
    name: "Training Dummy",
    roomId,
    hp: 100,
    maxHp: 100,
    tags: [],
  };
  const selfEnt = {
    id: "player_prefixed",
    type: "player",
    name: char.name,
    roomId,
    ownerSessionId: session.id,
    x: 0,
    z: 0,
    hp: 100,
    maxHp: 100,
    tags: [],
  };
  return {
    session,
    sessions: {
      getAllSessions: () => [session],
      get: (id: string) => (id === session.id ? session : null),
      send: () => {},
    },
    entities: {
      getAll: () => [selfEnt, npc],
      getEntitiesInRoom: (rid: string) => (rid === roomId ? [selfEnt, npc] : []),
      getEntityByOwner: (ownerSessionId: string) => (ownerSessionId === session.id ? selfEnt : null),
    },
    ignoreServiceProtection: false,
  };
}

test("[contract] castSpell accepts canonical class spell for pw_class_ runtime character", async () => {
  const char = makeChar("pw_class_ascetic");
  const ctx = makeCtx(char);

  const line = await castSpellForCharacter(ctx, char, TEST_CLASS_SPELL, "Training Dummy");

  assert.match(String(line), /Ascetic Test Bolt/i);
  assert.equal(char.classId, "pw_class_ascetic", "castSpell should not need to rewrite arbitrary caller-owned state");
});

test("[contract] listKnownSpells treats pw_class_ runtime class as canonical class", () => {
  const char = makeChar("pw_class_ascetic");
  const known = listKnownSpellsForChar(char);
  assert.ok(known.some((s: any) => String(s.classId).toLowerCase() === "ascetic"), "expected canonical ascetic spells to be visible to prefixed runtime class id");
});
