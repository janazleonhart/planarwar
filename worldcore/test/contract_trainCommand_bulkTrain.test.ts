// worldcore/test/contract_trainCommand_bulkTrain.test.ts
//
// Contract: bulk train helpers
// - train all: trains all pending spells + abilities
// - train spells: trains only spells (abilities remain pending)
//
// Tests avoid DB by stubbing ctx.characters with pure in-memory learn helpers.

import test from "node:test";
import assert from "node:assert/strict";

import { defaultSpellbook, defaultAbilities } from "../characters/CharacterTypes";
import { ABILITIES } from "../abilities/AbilityTypes";
import { grantAbilityInState, learnAbilityInState } from "../abilities/AbilityLearning";
import { grantSpellInState, learnSpellInState } from "../spells/SpellLearning";
import { handleTrainCommand } from "../mud/commands/player/trainCommand";

function mkWarrior(level = 1): any {
  return {
    id: "c1",
    userId: "u1",
    name: "Warrior",
    classId: "warrior",
    level,
    spellbook: defaultSpellbook(),
    abilities: defaultAbilities(),
  };
}

function pickWarriorAbilityId(): string {
  const ability = Object.values(ABILITIES).find(
    (a: any) =>
      String(a?.classId ?? "").toLowerCase() === "warrior" &&
      (a?.minLevel ?? 1) <= 1,
  ) as any;

  assert.ok(
    ability && ability.id,
    "Expected at least one warrior ability with minLevel<=1 in ABILITIES.",
  );
  return String(ability.id);
}

function makeCtx(character: any): any {
  return {
    // Training is intended to occur near a trainer.
    // The train command supports a test override flag.
    session: { character, isAtTrainer: true },
    sessions: {} as any,
    guilds: {} as any,
    characters: {
      async learnSpellWithRules(_userId: string, _charId: string, spellId: string, rank = 1, opts?: any) {
        const res = learnSpellInState(character as any, spellId, rank, 123, opts);
        if (!res.ok) return { ok: false, error: (res as any).error, requiredRule: (res as any).requiredRule };
        character = (res as any).next;
        return { ok: true, character };
      },
      async learnAbilityWithRules(_userId: string, _charId: string, abilityId: string, rank = 1, opts?: any) {
        const res = learnAbilityInState(character as any, abilityId, rank, 123, opts);
        if (!res.ok) return { ok: false, error: (res as any).error, requiredRule: (res as any).requiredRule };
        character = (res as any).next;
        return { ok: true, character };
      },
    },
  };
}

test("[contract] train all: trains all pending spells + abilities", async () => {
  const c0 = mkWarrior(1);
  const abilityId = pickWarriorAbilityId();

  const gS = grantSpellInState(c0 as any, "arcane_bolt", "test", 111);
  assert.equal(gS.ok, true);
  const c1 = (gS as any).next;

  const gA = grantAbilityInState(c1 as any, abilityId, "test", 111);
  assert.equal(gA.ok, true);
  const c2 = (gA as any).next;

  const ctx = makeCtx(c2);
  const out = await handleTrainCommand(ctx as any, ["all"]);

  assert.ok(typeof out === "string" && out.length > 0);

  const char = (ctx as any).session.character;
  assert.equal(!!char.spellbook?.known?.arcane_bolt, true);
  assert.equal(!!char.abilities?.learned?.[abilityId], true);
  assert.equal(!!char.spellbook?.pending?.arcane_bolt, false);
  assert.equal(!!char.abilities?.pending?.[abilityId], false);
});

test("[contract] train spells: only trains spells (abilities remain pending)", async () => {
  const c0 = mkWarrior(1);
  const abilityId = pickWarriorAbilityId();

  const gS = grantSpellInState(c0 as any, "arcane_bolt", "test", 111);
  assert.equal(gS.ok, true);
  const c1 = (gS as any).next;

  const gA = grantAbilityInState(c1 as any, abilityId, "test", 111);
  assert.equal(gA.ok, true);
  const c2 = (gA as any).next;

  const ctx = makeCtx(c2);
  const out = await handleTrainCommand(ctx as any, ["spells"]);

  assert.ok(typeof out === "string" && out.length > 0);

  const char = (ctx as any).session.character;
  assert.equal(!!char.spellbook?.known?.arcane_bolt, true);
  assert.equal(!!char.spellbook?.pending?.arcane_bolt, false);

  assert.equal(!!char.abilities?.pending?.[abilityId], true);
  assert.equal(!!char.abilities?.learned?.[abilityId], false);
});
