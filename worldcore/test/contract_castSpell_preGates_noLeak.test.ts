// worldcore/test/contract_castSpell_preGates_noLeak.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { castSpellForCharacter } from "../mud/MudSpells";
import { serviceProtectedCombatLine } from "../combat/ServiceProtection";
import { setRegionFlagsTestOverrides } from "../world/RegionFlags";
import { DUEL_SERVICE } from "../pvp/DuelService";

type AnyChar = any;
type AnySession = any;
type AnyEntity = any;

function makeChar(args: {
  id: string;
  name: string;
  classId?: string;
  level?: number;
  shardId?: string;
}): AnyChar {
  const classId = args.classId ?? "mage";
  const shardId = args.shardId ?? "prime_shard";
  const level = args.level ?? 1;

  // Pre-initialize progression blobs so we can assert “no leakage” cleanly.
  return {
    id: args.id,
    name: args.name,
    classId,
    level,
    shardId,
    spellbook: { known: {} },
    progression: {
      powerResources: {
        // mage primary is mana; leaving it explicit avoids lazy-init ambiguity in assertions.
        mana: { current: 100, max: 100 },
      },
      cooldowns: {},
      skills: {},
    },
    flags: {},
    statusEffects: {},
    attributes: {},
  };
}

function makeSession(args: { id: string; name: string; roomId: string; userId: string; char: AnyChar }): AnySession {
  return {
    id: args.id,
    name: args.name,
    roomId: args.roomId,
    userId: args.userId,
    character: args.char,
    char: args.char, // belt + suspenders (some callsites use .character, others .char)
  };
}

function makeCtx(args: {
  roomId: string;
  casterSession: AnySession;
  allSessions: AnySession[];
  entities: AnyEntity[];
}): any {
  const sessionsById = new Map<string, AnySession>();
  for (const s of args.allSessions) sessionsById.set(String(s.id), s);

  const entities = {
    getAll: () => args.entities,
    getEntityByOwner: (ownerSessionId: string) =>
      args.entities.find((e) => String(e.ownerSessionId ?? "") === String(ownerSessionId)) ?? null,
  };

  const sessions = {
    getAllSessions: () => args.allSessions,
    get: (id: string) => sessionsById.get(String(id)) ?? null,
    send: () => {
      // no-op for tests
    },
  };

  return {
    session: args.casterSession,
    sessions,
    entities,
    // Optional ctx knobs used by some gates; keep them falsey by default.
    ignoreServiceProtection: false,
  };
}

function getSpellCooldownReadyAt(char: AnyChar, spellId: string): number | null {
  const cd = char?.progression?.cooldowns?.spells?.[spellId];
  if (!cd) return null;
  const readyAt = Number(cd.readyAtMs ?? 0);
  return Number.isFinite(readyAt) && readyAt > 0 ? readyAt : null;
}

function getManaCurrent(char: AnyChar): number {
  return Number(char?.progression?.powerResources?.mana?.current ?? 0);
}

const TEST_SPELL: any = {
  id: "test_bolt",
  name: "Test Bolt",
  kind: "damage_single_npc",
  minLevel: 1,
  classId: "any",
  isDebug: true, // bypass “learned” checks for this contract
  resourceCost: 10,
  cooldownMs: 5000,
  damageMin: 5,
  damageMax: 5,
};

test("[contract] castSpell: service-protected NPC blocks BEFORE cost/cooldown", async () => {
  const roomId = "prime_shard:0,0";

  const caster = makeChar({ id: "char_caster_svc", name: "Caster", classId: "mage" });
  const casterSession = makeSession({ id: "sess_caster_svc", name: "Caster", roomId, userId: "u1", char: caster });

  const npc: AnyEntity = {
    id: "npc_banker",
    type: "npc",
    name: "Banker",
    roomId,
    hp: 999,
    maxHp: 999,
    tags: ["banker"], // ServiceProtection recognizes this tag
  };

  const selfEnt: AnyEntity = {
    id: "player_caster_ent",
    type: "player",
    name: "Caster",
    roomId,
    ownerSessionId: casterSession.id,
    hp: 100,
    maxHp: 100,
    tags: [],
  };

  const ctx = makeCtx({
    roomId,
    casterSession,
    allSessions: [casterSession],
    entities: [selfEnt, npc],
  });

  const manaBefore = getManaCurrent(caster);
  const cdBefore = getSpellCooldownReadyAt(caster, TEST_SPELL.id);

  const line = await castSpellForCharacter(ctx, caster, TEST_SPELL, "Banker");

  assert.equal(line, serviceProtectedCombatLine("Banker"));
  assert.equal(getManaCurrent(caster), manaBefore, "mana must not be spent when blocked by service protection");
  assert.equal(getSpellCooldownReadyAt(caster, TEST_SPELL.id), cdBefore, "cooldown must not start when blocked");
  assert.equal(npc.hp, 999, "NPC HP must not change when blocked");
});

test("[contract] castSpell: region combat disabled blocks BEFORE cost/cooldown", async () => {
  const roomId = "prime_shard:0,0";

  // Force combat off for this region.
  setRegionFlagsTestOverrides({
    prime_shard: {
      "0,0": { combatEnabled: false },
    },
  });

  try {
    const caster = makeChar({ id: "char_caster_region", name: "Caster", classId: "mage" });
    const casterSession = makeSession({ id: "sess_caster_region", name: "Caster", roomId, userId: "u1", char: caster });

    const npc: AnyEntity = {
      id: "npc_rat",
      type: "npc",
      name: "Rat",
      roomId,
      hp: 10,
      maxHp: 10,
      tags: [],
    };

    const selfEnt: AnyEntity = {
      id: "player_caster_ent2",
      type: "player",
      name: "Caster",
      roomId,
      ownerSessionId: casterSession.id,
      hp: 100,
      maxHp: 100,
      tags: [],
    };

    const ctx = makeCtx({
      roomId,
      casterSession,
      allSessions: [casterSession],
      entities: [selfEnt, npc],
    });

    const manaBefore = getManaCurrent(caster);
    const cdBefore = getSpellCooldownReadyAt(caster, TEST_SPELL.id);

    const line = await castSpellForCharacter(ctx, caster, TEST_SPELL, "Rat");

    assert.ok(
      String(line).toLowerCase().includes("combat is disabled"),
      `Expected “combat disabled” denial, got: ${line}`
    );
    assert.equal(getManaCurrent(caster), manaBefore, "mana must not be spent when region combat is disabled");
    assert.equal(getSpellCooldownReadyAt(caster, TEST_SPELL.id), cdBefore, "cooldown must not start when blocked");
    assert.equal(npc.hp, 10, "NPC HP must not change when blocked");
  } finally {
    // Important: do not leak overrides into other tests.
    setRegionFlagsTestOverrides(null);
  }
});

test("[contract] castSpell: PvP/duel gate blocks player target BEFORE cost/cooldown", async () => {
  const roomId = "prime_shard:0,0";

  // Make it explicit: PvP disabled (but combat enabled).
  setRegionFlagsTestOverrides({
    prime_shard: {
      "0,0": { combatEnabled: true, pvpEnabled: false },
    },
  });

  try {
    const caster = makeChar({ id: "char_caster_pvp", name: "Caster", classId: "mage" });
    const target = makeChar({ id: "char_target_pvp", name: "Target", classId: "mage" });

    const casterSession = makeSession({ id: "sess_caster_pvp", name: "Caster", roomId, userId: "u1", char: caster });
    const targetSession = makeSession({ id: "sess_target_pvp", name: "Target", roomId, userId: "u2", char: target });

    const selfEnt: AnyEntity = {
      id: "player_caster_ent3",
      type: "player",
      name: "Caster",
      roomId,
      ownerSessionId: casterSession.id,
      hp: 100,
      maxHp: 100,
      tags: [],
    };

    const targetEnt: AnyEntity = {
      id: "player_target_ent3",
      type: "player",
      name: "Target",
      roomId,
      ownerSessionId: targetSession.id,
      hp: 100,
      maxHp: 100,
      tags: [],
    };

    const ctx = makeCtx({
      roomId,
      casterSession,
      allSessions: [casterSession, targetSession],
      entities: [selfEnt, targetEnt],
    });

    const manaBefore = getManaCurrent(caster);
    const cdBefore = getSpellCooldownReadyAt(caster, TEST_SPELL.id);

    const line = await castSpellForCharacter(ctx, caster, TEST_SPELL, "Target");

    assert.ok(
      String(line).toLowerCase().includes("can't harm other players"),
      `Expected PvP denial, got: ${line}`
    );
    assert.equal(getManaCurrent(caster), manaBefore, "mana must not be spent when PvP gate denies");
    assert.equal(getSpellCooldownReadyAt(caster, TEST_SPELL.id), cdBefore, "cooldown must not start when blocked");
    assert.equal(targetEnt.hp, 100, "Target HP must not change when blocked");
  } finally {
    setRegionFlagsTestOverrides(null);
  }
});

test("[contract] castSpell: duel allows spell damage AND ends duel on death", async () => {
  const roomId = "prime_shard:0,0";

  // Ensure combat is enabled so duels are meaningful.
  setRegionFlagsTestOverrides({
    prime_shard: {
      "0,0": { combatEnabled: true, pvpEnabled: false, pvpMode: "duelOnly" },
    },
  });

  try {
    const caster = makeChar({ id: "char_caster_duel", name: "Caster", classId: "mage" });
    const target = makeChar({ id: "char_target_duel", name: "Target", classId: "mage" });

    const casterSession = makeSession({ id: "sess_caster_duel", name: "Caster", roomId, userId: "u1", char: caster });
    const targetSession = makeSession({ id: "sess_target_duel", name: "Target", roomId, userId: "u2", char: target });

    const selfEnt: AnyEntity = {
      id: "player_caster_ent4",
      type: "player",
      name: "Caster",
      roomId,
      ownerSessionId: casterSession.id,
      hp: 100,
      maxHp: 100,
      tags: [],
    };

    const targetEnt: AnyEntity = {
      id: "player_target_ent4",
      type: "player",
      name: "Target",
      roomId,
      ownerSessionId: targetSession.id,
      hp: 1, // ensure any damage kills -> duel must end
      maxHp: 100,
      tags: [],
    };

    const ctx = makeCtx({
      roomId,
      casterSession,
      allSessions: [casterSession, targetSession],
      entities: [selfEnt, targetEnt],
    });

    const now = Date.now();
    const req = DUEL_SERVICE.requestDuel(caster.id, caster.name, target.id, target.name, roomId, now);
    assert.equal(req.ok, true, "expected duel request to succeed");
    const acc = DUEL_SERVICE.acceptDuel(target.id, caster.id, roomId, now + 1);
    assert.equal(acc.ok, true, "expected duel accept to succeed");

    const line = await castSpellForCharacter(ctx, caster, TEST_SPELL, "Target");

    assert.equal(DUEL_SERVICE.getActiveDuel(caster.id) != null, false, "duel must end on death");
    assert.equal(targetEnt.hp, 0, "target must be dead (hp=0)");
    assert.ok(typeof line === "string" && line.length > 0, "cast should return a combat line");
  } finally {
    setRegionFlagsTestOverrides(null);
  }
});
