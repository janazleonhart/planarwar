//worldcore/test/contract_spellStatusEffectDefaults_refreshBuffDebuff.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import type { SpellDefinition } from "../spells/SpellTypes";
import { castSpellForCharacter } from "../mud/MudSpells";
import { computeCombatStatusSnapshot, getActiveStatusEffectsForEntity } from "../combat/StatusEffects";

function makeChar(id: string, name: string): CharacterState {
  return {
    id,
    userId: "u",
    shardId: "prime_shard",
    name,
    classId: "any",
    level: 1,
    xp: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    lastRegionId: null,
    appearanceTag: null,
    attributes: { str: 5, agi: 5, int: 5, sta: 5, wis: 5, cha: 5 },
    inventory: { bags: [], gold: 0 } as any,
    equipment: {} as any,
    spellbook: { known: {} } as any,
    abilities: {} as any,
    progression: {
      powerResources: { mana: { current: 50, max: 50 } },
      cooldowns: {},
      statusEffects: { active: {} },
    } as any,
    stateVersion: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  } as any;
}

class FakeEntities {
  private byOwner = new Map<string, any>();
  private ents: any[] = [];

  setOwner(ownerSessionId: string, ent: any) {
    this.byOwner.set(ownerSessionId, ent);
    this.ents.push(ent);
  }
  add(ent: any) {
    this.ents.push(ent);
  }
  getEntityByOwner(ownerSessionId: string) {
    return this.byOwner.get(ownerSessionId) ?? null;
  }
  getAll() {
    return this.ents;
  }
}

test("[contract] buff_self and debuff_single_npc default to refresh stacking (no stack explosion)", async () => {
  const caster = makeChar("c1", "Caster");

  const buff: SpellDefinition = {
    id: "contract_refresh_buff",
    name: "Contract Inspire",
    kind: "buff_self",
    classId: "any",
    minLevel: 1,
    description: "test",
    resourceType: "mana",
    resourceCost: 0,
    cooldownMs: 0,
    statusEffect: {
      id: "se_inspire_contract",
      name: "Inspired",
      durationMs: 10_000,
      // NOTE: intentionally omit stackingPolicy so defaults are exercised.
      modifiers: { damageDealtPct: 0.5 },
      tags: ["buff"],
    } as any,
  } as any;

  const debuff: SpellDefinition = {
    id: "contract_refresh_debuff",
    name: "Contract Weaken",
    kind: "debuff_single_npc",
    classId: "any",
    minLevel: 1,
    description: "test",
    resourceType: "mana",
    resourceCost: 0,
    cooldownMs: 0,
    statusEffect: {
      id: "se_weaken_contract",
      name: "Weakened",
      durationMs: 10_000,
      // NOTE: intentionally omit stackingPolicy so defaults are exercised.
      modifiers: { damageTakenPct: 0.25 },
      tags: ["debuff"],
    } as any,
  } as any;

  const sessionId = "sess_caster";
  const entities = new FakeEntities();
  entities.setOwner(sessionId, {
    id: "ent_caster",
    type: "player",
    ownerSessionId: sessionId,
    roomId: "prime_shard:0,0",
    x: 0,
    z: 0,
    hp: 50,
    maxHp: 50,
    alive: true,
    tags: [],
  });

  const npc: any = {
    id: "npc_dummy",
    type: "npc",
    name: "Training Dummy",
    roomId: "prime_shard:0,0",
    x: 2,
    z: 0,
    hp: 999,
    maxHp: 999,
    alive: true,
    combatStatusEffects: { active: {} },
    tags: ["training", "non_hostile"],
    behavior: "neutral",
  };
  entities.add(npc);

  const session = { id: sessionId, character: caster, roomId: "prime_shard:0,0" };
  const ctx: any = { session, entities, nowMs: 1_000_000 };

  // Cast buff twice; snapshot modifier must not double.
  await castSpellForCharacter(ctx, caster, buff, "");
  const snap1 = computeCombatStatusSnapshot(caster as any);
  assert.equal(snap1.damageDealtPct, 0.5);

  ctx.nowMs += 1000;
  await castSpellForCharacter(ctx, caster, buff, "");
  const snap2 = computeCombatStatusSnapshot(caster as any);
  assert.equal(snap2.damageDealtPct, 0.5, "buff_self should refresh (not stack) when stackingPolicy omitted");

  // Cast debuff twice; NPC should not accumulate stacks when stackingPolicy omitted.
  await castSpellForCharacter(ctx, caster, debuff, "dummy.1");
  ctx.nowMs += 1000;
  await castSpellForCharacter(ctx, caster, debuff, "dummy.1");

  const effects = getActiveStatusEffectsForEntity(npc as any, ctx.nowMs);
  const weaken = effects.find((e: any) => e.id === "se_weaken_contract");
  assert.ok(weaken, "expected debuff to exist on NPC");
  assert.equal(weaken.stackCount, 1, "debuff_single_npc should refresh (not stack) when stackingPolicy omitted");
});
