// worldcore/test/contract_hotTicks_generateHealThreat.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import type { SpellDefinition } from "../spells/SpellTypes";

import { EntityManager } from "../core/EntityManager";
import { SessionManager } from "../core/SessionManager";
import { RoomManager } from "../core/RoomManager";
import { ServerWorldManager } from "../world/ServerWorldManager";
import { TickEngine } from "../core/TickEngine";
import { NpcManager } from "../npc/NpcManager";
import { castSpellForCharacter } from "../mud/MudSpells";

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

test("[contract] HOT ticks generate healing threat on engaged NPCs", async () => {
  const realNow = Date.now;
  Date.now = () => 1_000_000;

  const oldTickHots = process.env.PW_TICK_PLAYER_HOTS;
  const oldHotMsgs = process.env.PW_HOT_TICK_MESSAGES;
  process.env.PW_TICK_PLAYER_HOTS = "1";
  process.env.PW_HOT_TICK_MESSAGES = "0";

  try {
    const entities = new EntityManager();
    const sessions = new SessionManager();

    const sock: any = { send: () => {}, close: () => {} };

    const healerSess: any = sessions.createSession(sock, "healer");
    const targetSess: any = sessions.createSession(sock, "target");

    const roomId = "prime_shard:0,0";
    healerSess.roomId = roomId;
    targetSess.roomId = roomId;

    const healerChar = makeChar("char_healer", "Healer");
    const targetChar = makeChar("char_target", "Target");
    healerSess.character = healerChar;
    targetSess.character = targetChar;

    const healerEnt = entities.createPlayerForSession(healerSess.id, roomId) as any;
    healerEnt.hp = 50;
    healerEnt.maxHp = 50;
    healerEnt.alive = true;

    const targetEnt = entities.createPlayerForSession(targetSess.id, roomId) as any;
    targetEnt.hp = 10;
    targetEnt.maxHp = 50;
    targetEnt.alive = true;

    const npcs = new NpcManager(entities, sessions);

    // Spawn an NPC in the room.
    const st = npcs.spawnNpcById("training_dummy", roomId, 0, 0, 0);
    assert.ok(st, "expected NPC spawn");
    const npcId = String((st as any).entityId);

    // Engage the NPC with the TARGET so it is eligible for healing threat.
    (npcs as any).recordDamage?.(npcId, String(targetEnt.id), 1_000_000);

    const spell: SpellDefinition = {
      id: "test_hot_threat_single_ally",
      name: "Test Regen Ally",
      kind: "heal_hot_single_ally",
      description: "test",
      classId: "cleric",
      minLevel: 1,
      resourceType: "mana",
      resourceCost: 0,
      cooldownMs: 0,
      statusEffect: {
        id: "se_test_regen_ally",
        name: "Regeneration",
        durationMs: 10_000,
        modifiers: {},
        tags: ["hot"],
        hot: { tickIntervalMs: 2000, perTickHeal: 7 },
      },
    };

    healerChar.spellbook.spells.push({ spellId: spell.id, minLevel: 1 });

    const ctx: any = {
      session: healerSess,
      entities,
      items: { getEquipped: () => [] },
      sessions,
      npcs,
    };

    const castMsg = await castSpellForCharacter(ctx, healerChar, spell, String(targetChar.name));
    const castStr = String(castMsg);
    assert.ok(
      castStr.toLowerCase().includes("regenerat") || castStr.includes("Regeneration"),
      castStr,
    );

    // Run TickEngine with NpcManager wired so HOT ticks can produce threat.
    const roomsMgr = new RoomManager(sessions, entities);
    const world = new ServerWorldManager(0xabc);
    const ticks = new TickEngine(entities, roomsMgr, sessions, world, { intervalMs: 50 }, npcs);

    (ticks as any).running = true;
    (ticks as any).lastTickAt = 1_000_000;

    // HOT tick at +2000ms.
    Date.now = () => 1_002_000;
    (ticks as any).tick();

    assert.equal(targetEnt.hp, 17, "expected HOT heal tick to apply");

    const threat = (npcs as any).getThreatState?.(npcId);
    assert.ok(threat, "expected threat state");

    const healerThreat = Number((threat as any)?.threatByEntityId?.[String(healerEnt.id)] ?? 0);
    assert.ok(healerThreat > 0, "expected HOT to add healing threat for healer");
  } finally {
    Date.now = realNow;
    if (oldTickHots === undefined) delete process.env.PW_TICK_PLAYER_HOTS;
    else process.env.PW_TICK_PLAYER_HOTS = oldTickHots;

    if (oldHotMsgs === undefined) delete process.env.PW_HOT_TICK_MESSAGES;
    else process.env.PW_HOT_TICK_MESSAGES = oldHotMsgs;
  }
});