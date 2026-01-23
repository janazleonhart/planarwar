// worldcore/test/contract_attack_noSuchTargetMessage.test.ts
//
// Contract: attack fallback messaging must be consistent with the canonical UX line.
//
// Why this exists:
// - Multiple systems route through TargetResolver + Nearby handles.
// - "No target" should be one predictable message so clients/tests/UI don't have to special-case variants.

import test from "node:test";
import assert from "node:assert/strict";

import { handleAttackAction } from "../mud/actions/MudCombatActions";

function makeCtx() {
  const roomId = "room-1";

  const selfEnt: any = {
    id: "ent-self",
    type: "player",
    ownerSessionId: "sess-1",
    roomId,
    name: "You",
    x: 0,
    z: 0,
  };

  const entitiesInRoom: any[] = [selfEnt];

  return {
    session: { id: "sess-1", roomId },
    world: {},

    // Minimal entity provider surface used by TargetResolver + MudCombatActions
    entities: {
      getEntityByOwner: (sid: string) => (sid === "sess-1" ? selfEnt : null),
      getEntitiesInRoom: (rid: string) =>
        entitiesInRoom.filter((e) => String(e.roomId) === String(rid)),
      getAll: () => entitiesInRoom,
    },

    // Minimal sessions surface used by findTargetPlayerEntityByName
    sessions: {
      getAllSessions: () => [],
    },
  };
}

test("[contract] attack fallback uses canonical no-such-target line", async () => {
  const ctx: any = makeCtx();
  const char: any = { id: "char-1", shardId: "prime_shard" };

  const out = await handleAttackAction(ctx, char, "Ally");
  assert.equal(out, "[world] No such target: 'Ally'.");
});
