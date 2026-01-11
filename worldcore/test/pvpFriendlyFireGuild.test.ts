// worldcore/test/pvpFriendlyFireGuild.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { canDamagePlayer } from "../pvp/PvpRules";

function c(overrides: Partial<any>) {
  return {
    id: overrides.id ?? "c",
    userId: "u",
    shardId: "prime_shard",
    name: "Test",
    classId: "adventurer",
    level: 1,
    xp: 0,
    posX: 0,
    posY: 0,
    attributes: {},
    inventory: {},
    equipment: {},
    spellbook: {},
    abilities: {},
    progression: { flags: {} },
    stateVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    guildId: overrides.guildId ?? null,
    ...overrides,
  };
}

test("PvP: open region blocks friendly fire for same guild (but duels still allow)", () => {
  const a = c({ id: "a", guildId: "g1" });
  const b = c({ id: "b", guildId: "g1" });
  const enemy = c({ id: "e", guildId: "g2" });

  // Open PvP region: same guild => blocked
  const g1 = canDamagePlayer(a as any, b as any, false, true);
  assert.equal(g1.allowed, false);
  assert.ok((g1 as any).reason.includes("Friendly fire"));

  // Open PvP region: different guild => allowed
  const g2 = canDamagePlayer(a as any, enemy as any, false, true);
  assert.equal(g2.allowed, true);
  assert.equal((g2 as any).mode, "pvp");

  // Duel overrides ally protection
  const duel = canDamagePlayer(a as any, b as any, true, false);
  assert.equal(duel.allowed, true);
  assert.equal((duel as any).mode, "duel");
});

test("PvP: non-open region blocks player damage", () => {
  const a = c({ id: "a", guildId: "g1" });
  const b = c({ id: "b", guildId: "g2" });

  const res = canDamagePlayer(a as any, b as any, false, false);
  assert.equal(res.allowed, false);
});
