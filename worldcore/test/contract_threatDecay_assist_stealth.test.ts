// worldcore/test/contract_threatDecay_assist_stealth.test.ts
//
// Contract: NPC threat decays deterministically, assist targeting respects the ally threat window,
// and assist never locks onto a stealthed player (no free tracking).

import test from "node:test";
import assert from "node:assert/strict";

import { decayThreat, getAssistTargetForAlly, updateThreatFromDamage, applyTauntToThreat, type NpcThreatState } from "../npc/NpcThreat";
import { tryAssistNearbyNpcs } from "../combat/NpcCombat";
import { applyStatusEffectToEntity } from "../combat/StatusEffects";

function makeCtx() {
  const entities = new Map<string, any>();
  const rooms = new Map<string, any>();
  const npcStates = new Map<string, any>();
  const damageCalls: any[] = [];

  const ctx: any = {
    entities: {
      get: (id: string) => entities.get(id),
    },
    rooms: {
      get: (id: string) => rooms.get(id),
    },
    npcs: {
      getNpcStateByEntityId: (id: string) => npcStates.get(id),
      recordDamage: (npcId: string, attackerId: string, amt: number) => {
        damageCalls.push({ npcId, attackerId, amt });
      },
    },
  };

  return { ctx, entities, rooms, npcStates, damageCalls };
}

test("[contract] npcThreat: decayThreat reduces buckets by whole seconds and prunes below", () => {
  const t0: NpcThreatState = {
    threatByEntityId: { a: 5, b: 1 },
    lastAggroAt: 0,
    lastDecayAt: 0,
  };

  const t1 = decayThreat(t0, { now: 2500, decayPerSec: 2, pruneBelow: 0 });
  // wholeSec = 2, dec = 4 -> a:1, b:0(pruned)
  assert.equal(t1?.threatByEntityId?.a, 1);
  assert.ok(!("b" in (t1?.threatByEntityId ?? {})));
  assert.equal(t1?.lastDecayAt, 2000);
});

test("[contract] npcThreat: assist target uses recent aggro window + top threat/forced target", () => {
  const now = 10_000;

  let threat: NpcThreatState | undefined = undefined;
  threat = updateThreatFromDamage(threat, "p1", 3, now - 1000);
  threat = updateThreatFromDamage(threat, "p2", 1, now - 1000);

  const target = getAssistTargetForAlly(threat, now, { windowMs: 5000, minTopThreat: 2 });
  assert.equal(target, "p1", "top threat should be p1");

  const taunted = applyTauntToThreat(threat, "p2", { durationMs: 4000, now });
  const forced = getAssistTargetForAlly(taunted, now, { windowMs: 5000, minTopThreat: 1 });
  assert.equal(forced, "p2", "forced target should be p2 while taunt active");
});

test("[contract] npcCombat assist: does not assist onto a stealthed player", () => {
  const { ctx, entities, rooms, npcStates, damageCalls } = makeCtx();

  const now = 50_000;
  const roomId = "prime_shard:0,0";

  // Ally NPC that would call for help.
  npcStates.set("ally", {
    entityId: "ally",
    roomId,
    templateId: "ally_proto",
    protoId: "ally_proto",
    threat: {
      lastAggroAt: now - 100,
      threatByEntityId: { player: 10 },
      lastAttackerEntityId: "player",
    },
  });

  entities.set("ally", { id: "ally", type: "npc", roomId, name: "Ally", hp: 10, maxHp: 10, alive: true });

  // Nearby social NPC eligible to assist.
  npcStates.set("helper", {
    entityId: "helper",
    roomId,
    templateId: "helper_proto",
    protoId: "helper_proto",
    tags: ["assist", "social"],
  });
  entities.set("helper", { id: "helper", type: "npc", roomId, name: "Helper", alive: true, tags: ["assist", "social"] });

  // Stealthed player attacker.
  const playerEnt: any = { id: "player", type: "player", roomId, name: "Sneaky", hp: 100, maxHp: 100, alive: true };
  applyStatusEffectToEntity(playerEnt, {
    id: "stealth_test",
    name: "Stealth",
    sourceKind: "spell",
    sourceId: "test",
    durationMs: 60_000,
    tags: ["stealth"],
      modifiers: {},
  }, now);
  entities.set("player", playerEnt);

  // Room contains ally + helper + player.
  rooms.set(roomId, { entityIds: ["ally", "helper", "player"], broadcast: () => {} });

  const assisted = tryAssistNearbyNpcs(ctx, "ally", "player", now, 5, 5);
  assert.equal(assisted, 0, "assist should not pull helpers onto stealthed target");
  assert.equal(damageCalls.length, 0, "no threat should be seeded when target is stealthed");
});
