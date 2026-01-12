import test, { after } from "node:test";
import assert from "node:assert/strict";

import { performNpcAttack } from "../combat/NpcCombat";
import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { LocalSimpleAggroBrain } from "../ai/LocalSimpleNpcBrain";

import type { CharacterState } from "../characters/CharacterTypes";
import type { BehaviorContext } from "../ai/brains/BehaviorContext";

after(() => {
  const handles = (process as any)._getActiveHandles?.() ?? [];
  const requests = (process as any)._getActiveRequests?.() ?? [];

  const summarize = (x: any) => {
    const name = x?.constructor?.name ?? typeof x;
    // some handles have extra hints
    const fd = (x as any)?.fd;
    const hasRef = typeof (x as any)?.hasRef === "function" ? (x as any).hasRef() : undefined;
    return { name, fd, hasRef };
  };

  console.error("\n[TEST DEBUG] Active handles:", handles.map(summarize));
  console.error("[TEST DEBUG] Active requests:", requests.map(summarize));
});

function createCharacter(id: string): CharacterState {
  const now = new Date();

  return {
    id,
    userId: "user-crime",
    shardId: "prime_shard",
    name: "Test Criminal",
    classId: "virtuoso",
    level: 1,
    xp: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    lastRegionId: null,
    appearanceTag: null,
    attributes: {
      str: 10,
      agi: 10,
      int: 10,
      sta: 10,
      wis: 10,
      cha: 10,
    },
    inventory: {
      bags: [],
      currency: {},
    },
    equipment: {},
    spellbook: {
      known: {},
    },
    abilities: {},
    progression: {},
    stateVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

test(
  "crime is recorded when attacking protected NPCs and guards warn",
  async () => {
    const entities = new EntityManager();
    const npcManager = new NpcManager(entities);

    const character = createCharacter("char-crime");

    // Player in a simple test room
    const player = entities.createPlayerForSession(
      "session-crime",
      "crime-room",
    );
    player.ownerSessionId = "session-crime";

    // Protected / civilian NPC
    const npcState = npcManager.spawnNpcById(
      "training_dummy",
      "crime-room",
      0,
      0,
      0,
    );
    assert.ok(npcState, "protected NPC should spawn");

    const npcEntity = entities.get(npcState!.entityId)!;

    // Use the same combat pipeline as the game
    const ctx = { npcs: npcManager, entities } as any;

    await performNpcAttack(ctx, character, player, npcEntity);

    // 1) Character gets crime markers
    assert.ok(
      character.recentCrimeUntil &&
        character.recentCrimeUntil > Date.now(),
      "crime timestamp should be set in the future",
    );

    assert.ok(
      character.recentCrimeSeverity === "minor" ||
        character.recentCrimeSeverity === "severe",
      "crime severity should be minor or severe",
    );

    // 2) Guard brain, given that perception, decides to WARN first
    const brain = new LocalSimpleAggroBrain();

    const guardCtx: BehaviorContext = {
      perception: {
        npcId: "guard-1",
        entityId: "guard-1",
        roomId: "crime-room",
        hp: 150,
        maxHp: 150,
        alive: true,
        behavior: "guard",
        hostile: true,
        playersInRoom: [
          {
            entityId: player.id,
            characterId: character.id,
            hp: player.hp,
            maxHp: player.maxHp,
            recentCrimeUntil: character.recentCrimeUntil,
            recentCrimeSeverity: character.recentCrimeSeverity,
            combatRole: "dps",
          },
        ],
        sinceLastDecisionMs: 200,
        lastAggroAt: Date.now(),
        lastAttackerId: player.id,
        guardProfile: "town",
        guardCallRadius: 10,
        roomIsSafeHub: true,
        npcName: "Town Guard",
      },
      players: [],
      cooldownMs: 0,
      attackCooldownMs: 2000,
      setCooldownMs: () => {},
      guardMemory: {
        hasWarned: () => false,
        markWarned: () => {},
        hasCalledHelp: () => false,
        markCalledHelp: () => {},
      },
    };

    const decision = brain.decide(guardCtx.perception, 200);

    assert.ok(
      decision && decision.kind === "say",
      "guard should issue a warning first",
    );
  },
);
