// worldcore/test/contract_ccDiminishingReturns_immunityNoCostNoCooldown_spellDebuffNpc.test.ts
//
// Contract: CC DR immunity stage must deny BEFORE spending resources or starting cooldowns.

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

test("[contract] CC DR immunity denies before cost/cooldown for debuff_single_npc", async () => {
  process.env.PW_CC_DR_ENABLED = "true";
  process.env.PW_CC_DR_WINDOW_MS = "18000";
  process.env.PW_CC_DR_TAGS = "mez";
  process.env.PW_CC_DR_MULTS = "1,0.5,0";

  const caster = makeChar("c1", "Caster");

  const spell: SpellDefinition = {
    id: "contract_cc_dr_mez_spell",
    name: "Contract Mez",
    kind: "debuff_single_npc",
    classId: "any",
    minLevel: 1,
    description: "test",
    resourceType: "mana",
    resourceCost: 10,
    cooldownMs: 5_000,
    statusEffect: {
      id: "mez_contract",
      name: "Mez",
      durationMs: 10_000,
      maxStacks: 1,
      stacks: 1,
      modifiers: {},
      tags: ["debuff", "mez"],
      stackingPolicy: "refresh",
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
  });

  const npc: any = { id: "npc_goblin", type: "npc", name: "Goblin", roomId: "prime_shard:0,0", x: 2, z: 0, statusEffects: { active: {} } };
  entities.add(npc);

  const session = { id: sessionId, character: caster, roomId: "prime_shard:0,0" };
  const ctx: any = { session, entities, nowMs: 1_000_000 };

  // Cast #1 (full) — spends mana + starts cooldown.
  const mana0 = (caster.progression as any).powerResources.mana.current;
  const out1 = await castSpellForCharacter(ctx, caster, spell, "goblin.1");
  assert.equal(String(out1).includes("afflict"), true);

  const mana1 = (caster.progression as any).powerResources.mana.current;
  assert.equal(mana1, mana0 - 10);

  // Advance time past cooldown, but inside DR window.
  ctx.nowMs = 1_000_000 + 6_000;

  const out2 = await castSpellForCharacter(ctx, caster, spell, "goblin.1");
  assert.equal(String(out2).includes("afflict"), true);

  const mana2 = (caster.progression as any).powerResources.mana.current;
  assert.equal(mana2, mana1 - 10);

  const cd2 = ((caster.progression as any).cooldowns?.spells?.[spell.id]?.readyAt) ?? null;
  assert.equal(typeof cd2, "number");

  // Advance time past cooldown again, still inside DR window → should be IMMUNE and side-effect free.
  ctx.nowMs = 1_000_000 + 12_000;

  const manaBeforeImmune = (caster.progression as any).powerResources.mana.current;
  const out3 = await castSpellForCharacter(ctx, caster, spell, "goblin.1");
  assert.equal(String(out3).toLowerCase().includes("immune"), true);

  const manaAfterImmune = (caster.progression as any).powerResources.mana.current;
  assert.equal(manaAfterImmune, manaBeforeImmune, "immune deny-path must not spend mana");

  const cd3 = ((caster.progression as any).cooldowns?.spells?.[spell.id]?.readyAt) ?? null;
  assert.equal(cd3, cd2, "immune deny-path must not restart cooldown");
});
