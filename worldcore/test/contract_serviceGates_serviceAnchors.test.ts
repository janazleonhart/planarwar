// worldcore/test/contract_serviceGates_serviceAnchors.test.ts
//
// Contract: serviceGates tag-based anchors
// - service_bank/service_mail/service_auction tags are sufficient on an NPC entity.
// - isNearTownService is best-effort and ignores PW_SERVICE_GATES (UX helper).

import test from "node:test";
import assert from "node:assert/strict";

import { isNearTownService } from "../mud/commands/world/serviceGates";

function mkChar(): any {
  return {
    id: "c1",
    userId: "u1",
    name: "Tester",
    classId: "warrior",
    level: 1,
    pos: { x: 0, y: 0, z: 0 },
  };
}

function makeCtx(entities: any[]): any {
  const roomId = "prime_shard:0,0";
  return {
    session: { character: mkChar(), roomId },
    entities: {
      getEntitiesInRoom: (rid: string) => (String(rid) === roomId ? entities : []),
    },
  };
}

test("[contract] serviceGates: service_bank tag alone is sufficient", () => {
  const ctx = makeCtx([
    { id: "npc_bank", type: "npc", tags: ["service_bank"], x: 0, z: 0 },
  ]);

  const ok = isNearTownService(ctx as any, (ctx as any).session.character, "bank");
  assert.equal(ok, true);
});

test("[contract] serviceGates: service_mail tag alone is sufficient", () => {
  const ctx = makeCtx([
    { id: "npc_mail", type: "npc", tags: ["service_mail"], x: 0, z: 0 },
  ]);

  const ok = isNearTownService(ctx as any, (ctx as any).session.character, "mail");
  assert.equal(ok, true);
});

test("[contract] serviceGates: service_auction tag alone is sufficient", () => {
  const ctx = makeCtx([
    { id: "npc_auction", type: "npc", tags: ["service_auction"], x: 0, z: 0 },
  ]);

  const ok = isNearTownService(ctx as any, (ctx as any).session.character, "auction");
  assert.equal(ok, true);
});
