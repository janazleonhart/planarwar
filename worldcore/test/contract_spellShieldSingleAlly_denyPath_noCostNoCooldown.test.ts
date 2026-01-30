// worldcore/test/contract_spellShieldSingleAlly_denyPath_noCostNoCooldown.test.ts
//
// Contract: shield (single ally) must resolve + deny invalid targets BEFORE
// spending resources or starting cooldowns.

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import type { SpellDefinition } from "../spells/SpellTypes";
import { castSpellForCharacter } from "../mud/MudSpells";

function makeChar(id: string, name: string): CharacterState {
  return {
    id,
    userId: "u",
    shardId: "prime_shard",
    name,
    classId: "archmage",
    level: 1,
    xp: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    lastRegionId: null,
    appearanceTag: null,
    attributes: { str: 1, agi: 1, int: 1, sta: 1, wis: 1, cha: 1 },
    inventory: { bags: [], gold: 0 } as any,
    equipment: {} as any,
    spellbook: { known: {} } as any,
    abilities: {} as any,
    progression: {
      // Resources + cooldowns live in progression JSONB.
      powerResources: { mana: { current: 50, max: 50 }, fury: { current: 0, max: 0 } },
      cooldowns: {},
      statusEffects: { active: {} },
    } as any,
    stateVersion: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  } as any;
}

class FakeSessions {
  private sessions: any[];
  constructor(sessions: any[]) {
    this.sessions = sessions;
  }
  getAllSessions() {
    return this.sessions;
  }
}

class FakeEntities {
  private byOwner = new Map<string, any>();
  set(ownerSessionId: string, ent: any) {
    this.byOwner.set(ownerSessionId, ent);
  }
  getEntityByOwner(ownerSessionId: string) {
    return this.byOwner.get(ownerSessionId) ?? null;
  }
}

test("[contract] shield_single_ally deny-path: invalid target does not spend mana or start cooldown", async () => {
  const caster = makeChar("c1", "Caster");

  const spell: SpellDefinition = {
    id: "contract_shield_single_ally",
    name: "Contract Shield Ally",
    kind: "shield_single_ally",
    classId: "any",
    minLevel: 1,
    description: "test",
    resourceType: "mana",
    resourceCost: 10,
    cooldownMs: 5_000,
    statusEffect: {
      id: "se_contract_shield_ally",
      name: "Contract Ally Ward",
      durationMs: 10_000,
      modifiers: {},
      tags: ["shield"],
      absorb: { amount: 25 },
    },
  } as any;

  const sessionId = "sess_caster";
  const entities = new FakeEntities();
  entities.set(sessionId, { id: "ent_caster", type: "player", ownerSessionId: sessionId, roomId: "prime_shard:0,0", x: 0, z: 0 });

  const session = { id: sessionId, character: caster, roomId: "prime_shard:0,0" };
  const ctx: any = { session, sessions: new FakeSessions([session]), entities };

  const manaBefore = (caster.progression as any).powerResources.mana.current;
  const sbBefore = (caster as any).spellbook?.cooldowns?.[spell.id];

  const out = await castSpellForCharacter(ctx, caster, spell, "banker.1");
  assert.equal(String(out).includes("No such target"), true, "expected deny-path for invalid player target");

  // No cooldown started (cooldowns live in char.progression.cooldowns.spells).
  const cdRoot = (caster.progression as any).cooldowns ?? {};
  const spellsBucket = cdRoot.spells ?? {};
  assert.equal(spellsBucket[spell.id], undefined, "deny-path must not start cooldown");

  // No spellbook cooldown started either.
  const sbAfter = (caster as any).spellbook?.cooldowns?.[spell.id];
  assert.equal(sbAfter, sbBefore, "deny-path must not start spellbook cooldown");

  // No mana spent.
  const manaAfter = (caster.progression as any).powerResources.mana.current;
  assert.equal(manaAfter, manaBefore, "deny-path must not spend mana");
});
