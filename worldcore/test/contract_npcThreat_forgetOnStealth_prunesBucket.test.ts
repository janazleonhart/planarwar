// worldcore/test/contract_npcThreat_forgetOnStealth_prunesBucket.test.ts
//
// Contract: when a target becomes invalid specifically due to stealth, the NPC threat
// selector may immediately forget that target (prune its threat bucket) to prevent
// "free tracking" where the NPC snaps back the instant stealth ends.
//
// This behavior is controlled by PW_THREAT_FORGET_ON_STEALTH (default true).

import test from "node:test";
import assert from "node:assert/strict";

import { selectThreatTarget, type NpcThreatState } from "../npc/NpcThreat";

test("[contract] npcThreat: stealth invalidation prunes threat bucket when enabled", () => {
  const prev = process.env.PW_THREAT_FORGET_ON_STEALTH;
  process.env.PW_THREAT_FORGET_ON_STEALTH = "1";

  try {
    const now = 100_000;

    const threat: NpcThreatState = {
      threatByEntityId: { stealthy: 10, visible: 5 },
      lastAttackerEntityId: "stealthy",
      lastAggroAt: now - 100,
    };

    const sel = selectThreatTarget(threat, now, (id) => {
      if (id === "stealthy") return { ok: false, reason: "stealth" };
      return { ok: true };
    });

    assert.equal(sel.targetId, "visible");
    assert.ok(sel.nextThreat);

    const table = (sel.nextThreat?.threatByEntityId ?? {}) as Record<string, number>;
    assert.equal("stealthy" in table, false, "stealth target should be forgotten (bucket pruned)");
    assert.equal(sel.nextThreat?.lastAttackerEntityId ?? null, null, "lastAttacker should be cleared if it points at stealthed target");
  } finally {
    if (prev === undefined) delete (process.env as any).PW_THREAT_FORGET_ON_STEALTH;
    else process.env.PW_THREAT_FORGET_ON_STEALTH = prev;
  }
});
