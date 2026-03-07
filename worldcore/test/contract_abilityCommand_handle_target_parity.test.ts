//worldcore/test/contract_abilityCommand_handle_target_parity.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { handleAbilityMudCommand } from "../mud/commands/combat/abilityCommand";
import { resolveNpcTargetEntityInRoom } from "../targeting/targetFinders";

function makeChar(): any {
  return {
    id: "char_ability_parity",
    userId: "u1",
    shardId: "prime_shard",
    roomId: "prime_shard:0,0",
    name: "Warrior",
    classId: "warrior",
    level: 5,
    abilities: { learned: {} },
    progression: { powerResources: { fury: { current: 100, max: 100 } }, cooldowns: {}, skills: {} },
    flags: {},
    statusEffects: {},
    attributes: { str: 12, agi: 8, sta: 10 },
    inventory: { currencies: {} },
  };
}

function makeCtx() {
  const char = makeChar();
  const roomId = "prime_shard:0,0";
  const session = { id: "sess_ability_parity", roomId, character: char };
  const selfEnt: any = {
    id: "player_ability_parity",
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

  return { ctx, char, npc, selfEnt };
}

test("[contract] resolveNpcTargetEntityInRoom accepts nearby handle token when given current actor entity", () => {
  const { ctx, npc, selfEnt } = makeCtx();
  const picked = resolveNpcTargetEntityInRoom(ctx, "prime_shard:0,0", "dummy.1", selfEnt);
  assert.equal((picked as any)?.id, npc.id);
});

test("[contract] ability command accepts nearby handle token with same dummy targeting semantics as attack", async () => {
  const { ctx } = makeCtx();
  const line = await handleAbilityMudCommand(ctx as any, ctx.session.character as any, {
    cmd: "ability",
    args: ["power_strike", "dummy.1"],
    parts: ["ability", "power_strike", "dummy.1"],
  });

  assert.doesNotMatch(String(line), /No such target/i);
});
