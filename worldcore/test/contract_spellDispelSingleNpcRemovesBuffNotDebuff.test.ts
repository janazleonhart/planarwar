// worldcore/test/contract_spellDispelSingleNpcRemovesBuffNotDebuff.test.ts
//
// Contract: dispel_single_npc removes tagged buffs from an NPC but does not remove unrelated debuffs.

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import type { SpellDefinition } from "../spells/SpellTypes";
import { castSpellForCharacter } from "../mud/MudSpells";
import { applyStatusEffectToEntity, getActiveStatusEffectsForEntity } from "../combat/StatusEffects";

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

test("[contract] dispel_single_npc removes buff-tagged effects but not debuffs", async () => {
  const caster = makeChar("c1", "Caster");

  const spell: SpellDefinition = {
    id: "contract_dispel_single_npc",
    name: "Contract Dispel",
    kind: "dispel_single_npc",
    classId: "any",
    minLevel: 1,
    description: "test",
    resourceType: "mana",
    resourceCost: 0,
    cooldownMs: 0,
    cleanse: { tags: ["buff"], maxToRemove: 10 },
  } as any;

  const sessionId = "sess_caster";
  const entities = new FakeEntities();
  entities.setOwner(sessionId, { id: "ent_caster", type: "player", ownerSessionId: sessionId, roomId: "prime_shard:0,0", x: 0, z: 0 });

  const npc: any = { id: "npc_goblin", type: "npc", name: "Goblin", roomId: "prime_shard:0,0", x: 2, z: 0, statusEffects: { active: {} } };
  entities.add(npc);

  const now0 = 1_000_000;

  // Apply one buff and one debuff.
  applyStatusEffectToEntity(
    npc,
    {
      id: "npc_buff_contract",
      name: "Buff",
      durationMs: 30_000,
      maxStacks: 1,
      stacks: 1,
      modifiers: {},
      tags: ["buff"],
      sourceKind: "spell",
      sourceId: "contract",
      appliedByKind: "system",
      appliedById: "system",
    },
    now0,
  );

  applyStatusEffectToEntity(
    npc,
    {
      id: "npc_debuff_contract",
      name: "Debuff",
      durationMs: 30_000,
      maxStacks: 1,
      stacks: 1,
      modifiers: {},
      tags: ["debuff"],
      sourceKind: "spell",
      sourceId: "contract",
      appliedByKind: "system",
      appliedById: "system",
    },
    now0,
  );

  const session = { id: sessionId, character: caster, roomId: "prime_shard:0,0" };
  const ctx: any = { session, entities, nowMs: now0 };

  const out = await castSpellForCharacter(ctx, caster, spell, "goblin.1");
  assert.equal(String(out).includes("dispel"), true);

  const active = getActiveStatusEffectsForEntity(npc, now0 + 1);
  assert.equal(active.some((e: any) => e.id === "npc_buff_contract"), false, "buff should be removed");
  assert.equal(active.some((e: any) => e.id === "npc_debuff_contract"), true, "debuff should remain");
});
