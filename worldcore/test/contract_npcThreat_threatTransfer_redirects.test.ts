// worldcore/test/contract_npcThreat_threatTransfer_redirects.test.ts
//
// Contract: a "threat transfer" status effect on an attacker can redirect
// some (or all) of the generated threat to another entity.
//
// This is wired in NpcManager.recordDamage so higher-level combat systems don't
// need to special-case threat mechanics.

import test from "node:test";
import assert from "node:assert/strict";

import { NpcManager } from "../npc/NpcManager";
import { applyStatusEffectToEntity } from "../combat/StatusEffects";

function makeEntityManager() {
  const ents = new Map<string, any>();
  let nextId = 1;

  const em: any = {
    _ents: ents,
    get: (id: string) => ents.get(id),
    setPosition: (id: string, x: number, y: number, z: number) => {
      const e = ents.get(id);
      if (!e) return;
      e.x = x;
      e.y = y;
      e.z = z;
    },
    createNpcEntity: (roomId: string, model: string) => {
      const id = `npc.${nextId++}`;
      const e: any = { id, type: "npc", roomId, model, alive: true };
      ents.set(id, e);
      return e;
    },
  };

  return { em, ents };
}

test("[contract] npcThreat: threat transfer redirects aggro to receiver", () => {
  const { em, ents } = makeEntityManager();
  const npcs = new NpcManager(em as any);

  const roomId = "prime_shard:0,0";

  // Attacker (dps) and receiver (tank)
  const tank: any = { id: "tank", type: "player", roomId, name: "Tank", alive: true, hp: 100, maxHp: 100 };
  const dps: any = { id: "dps", type: "player", roomId, name: "DPS", alive: true, hp: 100, maxHp: 100 };
  ents.set(tank.id, tank);
  ents.set(dps.id, dps);

  // Give DPS a threat transfer buff to Tank.
  const now = Date.now();
  applyStatusEffectToEntity(
    dps,
    {
      id: "threat_transfer_test",
      name: "Threat Transfer",
      sourceKind: "spell",
      sourceId: "test",
      durationMs: 60_000,
      tags: ["threat_transfer"],
      modifiers: {
        threatTransferToEntityId: "tank",
        threatTransferPct: 1,
      },
    },
    now,
  );

  // Spawn an NPC.
  const proto: any = {
    id: "test_npc",
    name: "Test NPC",
    model: "test_npc",
    maxHp: 10,
    tags: [],
  };
  const st = npcs.spawnNpc(proto, roomId, 0, 0, 0, null);

  // DPS damages the NPC, but threat should be credited to Tank.
  npcs.recordDamage(st.entityId, "dps", 10);

  const top = npcs.getTopThreatTarget(st.entityId, Date.now());
  assert.equal(top, "tank");
});
