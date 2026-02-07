// worldcore/test/contract_ranged_weaponSpeed_damageScale.test.ts
//
// Ensure weapon speed changes per-shot damage (normalized by base cadence)
// so faster weapons hit lighter per shot and slower weapons hit harder per shot.

import test from "node:test";
import assert from "node:assert/strict";

import { handleRangedAttackAction } from "../mud/actions/MudCombatActions";
import { getTrainingDummyForRoom } from "../mud/MudTrainingDummy";

type AnyChar = any;
type AnySession = any;
type AnyEntity = any;

function makeChar(args: { id: string; name: string; roomId: string; weaponSpeedMs: number }): AnyChar {
  return {
    id: args.id,
    name: args.name,
    classId: "outrider",
    level: 8,
    shardId: "prime_shard",
    equipment: {
      ranged: { itemId: "test_bow", qty: 1, meta: { speedMs: args.weaponSpeedMs } },
    },
    spellbook: { known: {} },
    progression: {
      powerResources: { mana: { current: 100, max: 100 } },
      cooldowns: {},
      skills: {},
    },
    flags: {},
    statusEffects: {},
    attributes: {
      // Inflate a bit so damage doesn't clamp to 1.
      str: 18,
      agi: 38,
      sta: 18,
      int: 10,
      spi: 10,
    },
  };
}

function makeSession(args: {
  id: string;
  name: string;
  roomId: string;
  userId: string;
  char: AnyChar;
}): AnySession {
  return {
    id: args.id,
    name: args.name,
    roomId: args.roomId,
    userId: args.userId,
    character: args.char,
    char: args.char,
  };
}

function makeCtx(args: { roomId: string; casterSession: AnySession; allSessions: AnySession[]; entities: AnyEntity[] }): any {
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
      // no-op
    },
  };

  const world = {
    getWorldBlueprintForRoom: (_roomId: string) => ({ objects: [] as any[] }),
  };

  return {
    session: args.casterSession,
    sessions,
    entities,
    world,
    npcs: {
      getNpcStateByEntityId: (id: string) => {
        if (String(id) === "npc_training_dummy") return { protoId: "training_dummy_big" };
        return null;
      },
    },
    ignoreServiceProtection: false,
  };
}

async function shootOnceAndMeasureDamage(roomId: string, weaponSpeedMs: number): Promise<number> {
  process.env.PW_RANGED_MAX_RANGE = "14";
  process.env.PW_RANGED_FOV_DEG = "360";

  // Normalize around 1000ms so 500ms -> 0.5x, 2000ms -> 2x (with default clamps).
  process.env.PW_AUTOFIRE_MS = "1000";
  process.env.PW_RANGED_DAMAGE_BASE_CADENCE_MS = "1000";
  process.env.PW_RANGED_DAMAGE_SCALE_MIN = "0.5";
  process.env.PW_RANGED_DAMAGE_SCALE_MAX = "2.0";

  const caster = makeChar({ id: `char_${weaponSpeedMs}`, name: "Archer", roomId, weaponSpeedMs });
  const casterSession = makeSession({ id: `sess_${weaponSpeedMs}`, name: "Archer", roomId, userId: "u1", char: caster });

  const selfEnt: AnyEntity = {
    id: `player_archer_${weaponSpeedMs}`,
    type: "player",
    name: "Archer",
    roomId,
    ownerSessionId: casterSession.id,
    hp: 100,
    maxHp: 100,
    x: 0,
    y: 0,
    z: 0,
    rotY: 0,
    tags: [],
  };

  const dummyEnt: AnyEntity = {
    id: "npc_training_dummy",
    type: "npc",
    name: "Training Dummy",
    roomId,
    hp: 200,
    maxHp: 200,
    alive: true,
    x: 0,
    y: 0,
    z: 6,
    tags: [],
  };

  const ctx = makeCtx({ roomId, casterSession, allSessions: [casterSession], entities: [selfEnt, dummyEnt] });

  const dummyState = getTrainingDummyForRoom(roomId);
  dummyState.maxHp = 200;
  dummyState.hp = 200;

  const before = dummyState.hp;
  const line = await handleRangedAttackAction(ctx, caster, "Training Dummy");

  const lower = String(line).toLowerCase();
  const looksLikeShoot = lower.includes("you shoot") && lower.includes(" damage");
  assert.ok(looksLikeShoot, `Expected a successful shoot line, got: ${line}`);

  const after = dummyState.hp;
  const dealt = before - after;
  return dealt;
}

test("[contract] ranged: faster weapon deals less per-shot damage (normalized by cadence)", async () => {
  const dmgFast = await shootOnceAndMeasureDamage("prime_shard:1,1", 500);
  const dmgSlow = await shootOnceAndMeasureDamage("prime_shard:1,2", 2000);

  assert.ok(dmgFast > 0 && dmgSlow > 0, `Expected both shots to deal damage (fast=${dmgFast}, slow=${dmgSlow})`);
  assert.ok(dmgSlow > dmgFast, `Expected slow weapon to hit harder per shot (fast=${dmgFast}, slow=${dmgSlow})`);
});
