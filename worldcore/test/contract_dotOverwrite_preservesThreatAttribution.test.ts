// worldcore/test/contract_dotOverwrite_preservesThreatAttribution.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { SessionManager } from "../core/SessionManager";
import { RoomManager } from "../core/RoomManager";
import { ServerWorldManager } from "../world/ServerWorldManager";
import { TickEngine } from "../core/TickEngine";
import { NpcManager } from "../npc/NpcManager";
import { getThreatValue } from "../npc/NpcThreat";
import { applyStatusEffectToEntity } from "../combat/StatusEffects";

test(
  "[contract] DOT overwrite rank upgrade preserves threat attribution to original caster",
  () => {
    process.env.WORLDCORE_TEST = "1";
    process.env.PW_DOT_TICK_MESSAGES = "0";
    process.env.PW_DOT_COMBAT_LOG = "0";

    const entities = new EntityManager();
    const sessions = new SessionManager();
    const npcs = new NpcManager(entities, sessions);

    // Minimal player session + character
    const sock: any = { send: () => {}, close: () => {} };
    const session: any = sessions.createSession(sock, "shard.1");
    session.identity = { userId: "U1" };

    const char: any = { id: "C1", name: "Tester", level: 1 };
    session.character = char;

    const roomId = "room.dot.overwrite.1";
    const player = entities.createPlayerForSession(session.id, roomId) as any;
    player.ownerSessionId = session.id;

    const dummy = npcs.spawnNpcById("training_dummy", roomId, 0, 0, 0);
    assert.ok(dummy, "training dummy should spawn");
    const npcEnt: any = entities.get((dummy as any).entityId);
    assert.ok(npcEnt, "npc entity should exist");

    const roomsMgr = new RoomManager(sessions, entities);
    const world = new ServerWorldManager(0xabc);
    const tick = new TickEngine(entities, roomsMgr, sessions, world, { intervalMs: 50 }, npcs);

    const now0 = 1_000_000;

    // Rank I DOT (appliedById is CharacterState.id so TickEngine can map -> session -> player entity id)
    applyStatusEffectToEntity(
      npcEnt,
      {
        id: "dot_test_rank1",
        sourceKind: "spell",
        sourceId: "test_dot_rank1",
        name: "Test Dot I",
        durationMs: 10_000,
        modifiers: {},
        stackingGroupId: "grp_ranked_dot",
        stackingPolicy: "overwrite",
        dot: { tickIntervalMs: 1000, perTickDamage: 5, damageSchool: "pure" },
        appliedByKind: "character",
        appliedById: char.id,
      },
      now0,
    );

    // First tick should attribute threat to the player entity.
    (tick as any).tickNpcStatusDots(now0 + 1000);
    const st1 = npcs.getThreatState((dummy as any).entityId);
    assert.ok(st1, "npc threat state should exist after first DOT tick");
    const t1 = getThreatValue(st1 as any, player.id);
    assert.ok(t1 > 0, "expected DOT tick to add threat for caster entity");

    // Rank II overwrite upgrade. Applier fields included to ensure threat attribution remains correct.
    applyStatusEffectToEntity(
      npcEnt,
      {
        id: "dot_test_rank2",
        sourceKind: "spell",
        sourceId: "test_dot_rank2",
        name: "Test Dot II",
        durationMs: 10_000,
        modifiers: {},
        stackingGroupId: "grp_ranked_dot",
        stackingPolicy: "overwrite",
        dot: { tickIntervalMs: 700, perTickDamage: 12, damageSchool: "pure" },
        appliedByKind: "character",
        appliedById: char.id,
        // applier included to preserve threat attribution
      } as any,
      now0 + 1200,
    );

    // Tick after overwrite: threat should still be attributed to the same caster.
    (tick as any).tickNpcStatusDots(now0 + 1200 + 700);
    const st2 = npcs.getThreatState((dummy as any).entityId);
    assert.ok(st2, "npc threat state should exist after overwrite tick");
    const t2 = getThreatValue(st2 as any, player.id);
    assert.ok(t2 > t1, "expected overwrite DOT tick to continue adding threat for caster entity");
  },
);
