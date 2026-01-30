// worldcore/test/contract_tickEngine_playerHotTicks.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import type { SpellDefinition } from "../spells/SpellTypes";

import { EntityManager } from "../core/EntityManager";
import { SessionManager } from "../core/SessionManager";
import { castSpellForCharacter } from "../mud/MudSpells";
import { tickAllPlayerHots } from "../combat/PlayerHotTicker";

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

test("[contract] TickEngine-like loop ticks player HOTs via PlayerHotTicker", async () => {
  const realNow = Date.now;
  Date.now = () => 1_000_000;

  const oldEnv = process.env.PW_HOT_TICK_MESSAGES;
  process.env.PW_HOT_TICK_MESSAGES = "1";

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

    // First tick @ t=+2000
    tickAllPlayerHots(entities, sessions, 1_002_000);
    assert.equal(player.hp, 17);

    // Ensure a HOT tick combat line was emitted.
    const last = sent[sent.length - 1];
    assert.ok(last, "expected at least one message");
    const text = (last?.payload?.text ?? "") as string;
    assert.ok(text.includes("restores 7 health"), text);

    // Second tick @ t=+4000
    tickAllPlayerHots(entities, sessions, 1_004_000);
    assert.equal(player.hp, 24);
  } finally {
    Date.now = realNow;
    if (oldEnv === undefined) delete process.env.PW_HOT_TICK_MESSAGES;
    else process.env.PW_HOT_TICK_MESSAGES = oldEnv;
  }
});
