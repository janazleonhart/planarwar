// worldcore/test/contract_tickEngine_playerStatusPrunes.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";

import { EntityManager } from "../core/EntityManager";
import { SessionManager } from "../core/SessionManager";
import { RoomManager } from "../core/RoomManager";
import { ServerWorldManager } from "../world/ServerWorldManager";
import { TickEngine } from "../core/TickEngine";
import { applyStatusEffect, getActiveStatusEffects } from "../combat/StatusEffects";

function makeChar(name: string): CharacterState {
  return {
    id: "char_" + name.toLowerCase(),
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

test("[contract] TickEngine prunes expired player status effects even out of combat", async () => {
  const realNow = Date.now;
  Date.now = () => 1_000_000;

  const oldTickStatus = process.env.PW_TICK_PLAYER_STATUS;
  const oldTickHots = process.env.PW_TICK_PLAYER_HOTS;
  process.env.PW_TICK_PLAYER_STATUS = "1";
  process.env.PW_TICK_PLAYER_HOTS = "0";

  try {
    const entities = new EntityManager();
    const sessions = new SessionManager();

    const sock: any = { send: () => {}, close: () => {} };
    const session: any = sessions.createSession(sock, "tester");
    const roomId = "prime_shard:0,0";
    session.roomId = roomId;

    const char = makeChar("Caster");
    session.character = char;

    const player = entities.createPlayerForSession(session.id, roomId) as any;
    player.hp = 10;
    player.maxHp = 50;
    player.alive = true;

    // Apply a short-lived buff with no HOT/DOT payload.
    applyStatusEffect(
      char as any,
      {
        id: "se_short_buff",
        name: "Short Buff",
        durationMs: 500,
        modifiers: { damageDealtPct: 0.1 },
        tags: ["buff"],
      } as any,
      1_000_000,
    );

    assert.equal(getActiveStatusEffects(char as any, 1_000_000).length, 1);

    const roomsMgr = new RoomManager(sessions, entities);
    const world = new ServerWorldManager(0xabc);
    const ticks = new TickEngine(entities, roomsMgr, sessions, world, { intervalMs: 50 });

    (ticks as any).running = true;
    (ticks as any).lastTickAt = 1_000_000;

    // Advance beyond expiry and tick.
    Date.now = () => 1_001_000;
    (ticks as any).tick();

    assert.equal(getActiveStatusEffects(char as any, 1_001_000).length, 0);
  } finally {
    Date.now = realNow;

    if (oldTickStatus === undefined) delete process.env.PW_TICK_PLAYER_STATUS;
    else process.env.PW_TICK_PLAYER_STATUS = oldTickStatus;

    if (oldTickHots === undefined) delete process.env.PW_TICK_PLAYER_HOTS;
    else process.env.PW_TICK_PLAYER_HOTS = oldTickHots;
  }
});
