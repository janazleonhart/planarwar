// worldcore/test/contract_serverBuffs_applyAndSync.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";

import { EntityManager } from "../core/EntityManager";
import { SessionManager } from "../core/SessionManager";
import { addServerBuff, clearAllServerBuffs, syncServerBuffsToConnectedPlayers } from "../status/ServerBuffs";
import { getActiveStatusEffects } from "../combat/StatusEffects";

function makeChar(id: string, name: string): CharacterState {
  return {
    id,
    name,
    level: 1,
    classId: "cleric",
    xp: 0,
    xpToNextLevel: 100,
    attributes: { str: 5, dex: 5, int: 5, wis: 5, con: 5, cha: 5 },
    resources: {
      mana: { current: 0, max: 0 },
      stamina: { current: 0, max: 0 },
      energy: { current: 0, max: 0 },
    },
    spellbook: { spells: [], songs: [] },
    progression: {
      cooldowns: {},
      statusEffects: { active: {}, index: {} },
      songSkills: {},
    },
  } as any;
}

test("[contract] ServerBuffs sync applies active server buffs to connected players", async () => {
  const realNow = Date.now;
  Date.now = () => 1_000_000;
  try {
    clearAllServerBuffs();

    const entities = new EntityManager();
    const sessions = new SessionManager();
    const sock: any = { send: () => {}, close: () => {} };

    const s1: any = sessions.createSession(sock, "tester1");
    s1.roomId = "prime_shard:0,0";
    s1.character = makeChar("char.1", "One");
    entities.createPlayerForSession(s1.id, s1.roomId);

    addServerBuff(
      "weekend_boost",
      {
        durationMs: 60_000,
        name: "Weekend Boost",
        modifiers: { damageDealtPct: 0.25 },
        tags: ["event"],
      } as any,
      1_000_000,
    );

    syncServerBuffsToConnectedPlayers(entities, sessions, 1_000_000);

    const effects1 = getActiveStatusEffects(s1.character as any, 1_000_000).map((e: any) => e.id);
    assert.ok(effects1.includes("server_buff:weekend_boost"));

    // New player connects after buff is active.
    const s2: any = sessions.createSession(sock, "tester2");
    s2.roomId = "prime_shard:0,0";
    s2.character = makeChar("char.2", "Two");
    entities.createPlayerForSession(s2.id, s2.roomId);

    syncServerBuffsToConnectedPlayers(entities, sessions, 1_000_050);
    const effects2 = getActiveStatusEffects(s2.character as any, 1_000_050).map((e: any) => e.id);
    assert.ok(effects2.includes("server_buff:weekend_boost"));
  } finally {
    clearAllServerBuffs();
    Date.now = realNow;
  }
});
