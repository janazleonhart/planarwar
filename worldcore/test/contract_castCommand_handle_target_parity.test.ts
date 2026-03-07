//worldcore/test/contract_castCommand_handle_target_parity.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { handleCastMudCommand } from "../mud/commands/combat/castCommand";
import { resolveNpcTargetEntityInRoom } from "../targeting/targetFinders";

function makeChar(): any {
  return {
    id: "char_cast_parity",
    userId: "u1",
    shardId: "prime_shard",
    roomId: "prime_shard:0,0",
    name: "Caster",
    classId: "any",
    level: 1,
    spellbook: { known: {} },
    progression: { powerResources: { mana: { current: 100, max: 100 } }, cooldowns: {}, skills: {} },
    flags: {},
    statusEffects: {},
    attributes: { int: 10, wis: 10 },
  };
}

function makeCtx() {
  const char = makeChar();
  const roomId = "prime_shard:0,0";
  const session = { id: "sess_cast_parity", roomId, character: char };
  const selfEnt: any = {
    id: "player_cast_parity",
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
  const npc: any = {
    id: "npc_training_dummy_big",
    type: "npc",
    protoId: "training_dummy_big",
    name: "Sturdy Training Dummy",
    roomId,
    x: 2,
    z: 0,
    hp: 200,
    maxHp: 200,
    alive: true,
    tags: ["training"],
    combatStatusEffects: { active: {} },
  };
  selfEnt.engagedTargetId = npc.id;

  const entities = {
    getAll: () => [selfEnt, npc],
    getEntitiesInRoom: (rid: string) => (rid === roomId ? [selfEnt, npc] : []),
    getEntityByOwner: (ownerSessionId: string) => (ownerSessionId === session.id ? selfEnt : null),
    getEntity: (id: string) => ([selfEnt, npc].find((e) => e.id === id) ?? null),
  };

  const ctx: any = {
    session,
    sessions: {
      getAllSessions: () => [session],
      get: (id: string) => (id === session.id ? session : null),
      send: () => {},
    },
    entities,
    ignoreServiceProtection: false,
    nowMs: 1_000_000,
  };

  return { ctx, char, npc };
}

test("[contract] resolveNpcTargetEntityInRoom accepts nearby handle token for engaged dummy target", () => {
  const { ctx, npc } = makeCtx();
  const picked = resolveNpcTargetEntityInRoom(ctx, "prime_shard:0,0", "dummy.1");
  assert.equal((picked as any)?.id, npc.id);
});

test("[contract] cast command accepts nearby handle token with same dummy targeting semantics as attack", async () => {
  const { ctx } = makeCtx();
  const line = await handleCastMudCommand(ctx as any, ctx.session.character as any, {
    cmd: "cast",
    args: ["arcane_bolt", "dummy.1"],
    parts: ["cast", "arcane_bolt", "dummy.1"],
  });

  assert.match(String(line), /\[spell:Arcane Bolt\] You hit Sturdy Training Dummy/i);
});
