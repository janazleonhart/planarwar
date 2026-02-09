// worldcore/test/contract_mudCombat_pvpRiposte_onParry.test.ts
//
// Contract: In a duel, if the defender parries an incoming melee swing, they can riposte
// for deterministic damage, and the attacker does not receive any extra free swings.
//
// This contract exists because PvP combat uses MudCombatActions.handleAttackAction,
// which must remain testable/deterministic via an injectable RNG.

import test from "node:test";
import assert from "node:assert/strict";

import { handleAttackAction } from "../mud/actions/MudCombatActions";
import { DUEL_SERVICE } from "../pvp/DuelService";

function makeSeqRng(seq: number[]): () => number {
  let i = 0;
  return () => {
    const v = seq[Math.min(i, seq.length - 1)];
    i += 1;
    return v;
  };
}

test("[contract] MudCombat: duel parry can trigger deterministic riposte damage", async () => {
  const oldNow = Date.now;
  const oldEnv = { ...process.env };

  try {
    process.env.WORLDCORE_TEST = "1";
    process.env.PW_RIPOSTE_CHANCE_ON_PARRY = "1";
    process.env.PW_RIPOSTE_DAMAGE_MULTIPLIER = "1";

    // Freeze time so duel ticking is stable.
    Date.now = () => 1_000_000;

    const roomId = "room-1";

    const attackerChar: any = {
      id: "char-a",
      name: "Alice",
      shardId: "prime_shard",
      level: 1,
      attributes: { str: 10, agi: 10, sta: 10, int: 10, wis: 10, cha: 10 },
    };

    const defenderChar: any = {
      id: "char-b",
      name: "Bob",
      shardId: "prime_shard",
      level: 1,
      attributes: { str: 10, agi: 10, sta: 10, int: 10, wis: 10, cha: 10 },
    };

    // Establish an active duel so PvP gating passes.
    const now = Date.now();
    const req = DUEL_SERVICE.requestDuel(attackerChar.id, attackerChar.name, defenderChar.id, defenderChar.name, roomId, now);
    assert.equal(req.ok, true, "expected duel request to succeed");
    const acc = DUEL_SERVICE.acceptDuel(defenderChar.id, attackerChar.id, roomId, now);
    assert.equal(acc.ok, true, "expected duel accept to succeed");

    const attackerEnt: any = {
      id: "ent-a",
      type: "player",
      ownerSessionId: "sess-a",
      roomId,
      name: attackerChar.name,
      x: 0,
      z: 0,
      hp: 20,
      maxHp: 20,
      alive: true,
    };

    const defenderEnt: any = {
      id: "ent-b",
      type: "player",
      ownerSessionId: "sess-b",
      roomId,
      name: defenderChar.name,
      x: 1,
      z: 0,
      hp: 20,
      maxHp: 20,
      alive: true,
    };

    const sent: any[] = [];

    const sessA: any = { id: "sess-a", character: attackerChar };
    const sessB: any = { id: "sess-b", character: defenderChar };

    // Force parry via the injected combat RNG:
    // resolvePhysicalHit consumes rHit then rAvoid.
    // rHit=0 => hit passes; rAvoid=0.04 => in the parry band at low levels.
    const rng = makeSeqRng([0.0, 0.04, 0.0]);

    const ctx: any = {
      session: sessA,
      world: {},

      combatRng: rng,

      entities: {
        getEntityByOwner: (sid: string) => (sid === "sess-a" ? attackerEnt : sid === "sess-b" ? defenderEnt : null),
        getEntitiesInRoom: (rid: string) => [attackerEnt, defenderEnt].filter((e) => String(e.roomId) === String(rid)),
        getAll: () => [attackerEnt, defenderEnt],
      },

      sessions: {
        get: (sid: string) => (sid === "sess-a" ? sessA : sid === "sess-b" ? sessB : null),
        getAllSessions: () => [sessA, sessB],
        send: (session: any, kind: string, payload: any) => {
          sent.push({ sessionId: session?.id ?? session, kind, payload });
        },
      },
    };

    const out = await handleAttackAction(ctx, attackerChar, defenderChar.name);

    // Return line should indicate the parry.
    assert.match(out, /parr/i);

    // Riposte should damage the attacker for exactly the defender's base (str=10 agi=10 => 5).
    assert.equal(attackerEnt.hp, 15);

    // Ensure we emitted a riposte message to the attacker.
    const attackerMsgs = sent.filter((m) => m.sessionId === "sess-a" && m.kind === "chat").map((m) => String(m.payload?.text ?? ""));
    assert.ok(attackerMsgs.some((t) => /ripostes you for 5 damage/i.test(t)), "expected attacker to receive riposte message");

    // No weird self-swing outcomes: we should NOT claim the attacker hit the defender.
    assert.ok(!/You hit/i.test(out), "parry outcome should not include a hit line");
  } finally {
    Date.now = oldNow;
    process.env = oldEnv;
  }
});
