// worldcore/test/damagePolicy_regionCombatEnabled.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { canDamage, resolvePlayerVsPlayerPolicy } from "../combat/DamagePolicy";

function makeChar(id: string): any {
  return { id, name: id, shardId: "prime_shard", guildId: null };
}

test("resolvePlayerVsPlayerPolicy blocks when combat is disabled, even if duel", async () => {
  const a = makeChar("a");
  const d = makeChar("d");

  const r = await resolvePlayerVsPlayerPolicy(a, d, {
    shardId: "prime_shard",
    regionId: "0,0",
    inDuel: true,
    regionCombatEnabled: false,
    regionPvpEnabled: true,
  });

  assert.equal(r.allowed, false);
  assert.equal(r.reason, "Combat is disabled in this region.");
});

test("canDamage blocks when combat is disabled (PvE too) when region is provided", async () => {
  const a = makeChar("a");
  const defenderEnt: any = { id: "svc", name: "Dummy", hp: 100, maxHp: 100, alive: true };

  const d = await canDamage(
    { char: a },
    { entity: defenderEnt },
    { shardId: "prime_shard", regionId: "0,0", regionCombatEnabled: false },
  );

  assert.equal(d.allowed, false);
  assert.equal(d.reason, "Combat is disabled in this region.");
});
