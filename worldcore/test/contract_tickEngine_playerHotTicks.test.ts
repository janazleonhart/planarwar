// worldcore/test/contract_tickEngine_playerHotTicks.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import type { SpellDefinition } from "../spells/SpellTypes";

import { EntityManager } from "../core/EntityManager";
import { SessionManager } from "../core/SessionManager";
import { RoomManager } from "../core/RoomManager";
import { ServerWorldManager } from "../world/ServerWorldManager";
import { TickEngine } from "../core/TickEngine";
import { castSpellForCharacter } from "../mud/MudSpells";

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

test("[contract] TickEngine ticks player HOTs in heartbeat", async () => {
  const realNow = Date.now;
  Date.now = () => 1_000_000;

  const oldHotMsgs = process.env.PW_HOT_TICK_MESSAGES;
  const oldTickHots = process.env.PW_TICK_PLAYER_HOTS;
  process.env.PW_HOT_TICK_MESSAGES = "1";
  process.env.PW_TICK_PLAYER_HOTS = "1";

  try {
    const entities = new EntityManager();
    const sessions = new SessionManager();

    const sent: any[] = [];
    const sock: any = {
      send: (json: string) => {
        try {
          sent.push(JSON.parse(json));
        } catch {
          sent.push(json);
        }
      },
      close: () => {},
    };

    const session: any = sessions.createSession(sock, "tester");
    const roomId = "prime_shard:0,0";
    session.roomId = roomId;

    const char = makeChar("Caster");
    session.character = char;

    const player = entities.createPlayerForSession(session.id, roomId) as any;
    player.hp = 10;
    player.maxHp = 50;
    player.alive = true;

    const spell: SpellDefinition = {
      id: "test_hot_self_tickengine",
      name: "Test Regeneration",
      kind: "heal_hot_self",
      description: "test",
      classId: "cleric",
      minLevel: 1,
      resourceType: "mana",
      resourceCost: 0,
      cooldownMs: 0,
      statusEffect: {
        id: "se_regen",
        name: "Regeneration",
        durationMs: 10_000,
        modifiers: {},
        tags: ["hot"],
        hot: { tickIntervalMs: 2000, perTickHeal: 7 },
      },
    };

    char.spellbook.spells.push({ spellId: spell.id, minLevel: 1 });

    const ctx: any = {
      session,
      entities,
      items: { getEquipped: () => [] },
    };

    const msg = await castSpellForCharacter(ctx, char, spell, "");
    assert.ok(msg.includes("regenerating") || msg.includes("Regeneration"), msg);

    const roomsMgr = new RoomManager(sessions, entities);
    const world = new ServerWorldManager(0xabc);
    const ticks = new TickEngine(entities, roomsMgr, sessions, world, { intervalMs: 50 });

    // TickEngine.tick() is private and no-ops unless running.
    // For contract tests we manually enable running and call the private tick.
    (ticks as any).running = true;
    (ticks as any).lastTickAt = 1_000_000;

    // First tick @ t=+2000
    Date.now = () => 1_002_000;
    (ticks as any).tick();
    assert.equal(player.hp, 17);

    // Ensure a HOT tick combat line was emitted.
    const last = sent[sent.length - 1];
    assert.ok(last, "expected at least one message");
    const text = (last?.payload?.text ?? "") as string;
    assert.ok(text.includes("restores 7 health"), text);

    // Second tick @ t=+4000
    Date.now = () => 1_004_000;
    (ticks as any).tick();
    assert.equal(player.hp, 24);
  } finally {
    Date.now = realNow;
    if (oldHotMsgs === undefined) delete process.env.PW_HOT_TICK_MESSAGES;
    else process.env.PW_HOT_TICK_MESSAGES = oldHotMsgs;

    if (oldTickHots === undefined) delete process.env.PW_TICK_PLAYER_HOTS;
    else process.env.PW_TICK_PLAYER_HOTS = oldTickHots;
  }
});
