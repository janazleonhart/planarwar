// worldcore/test/contract_trainCommand_previewWhy.test.ts
//
// Contract: train preview --why
// - Adds a "why" suffix with error code + rule/def hints for blocked entries.

import test from "node:test";
import assert from "node:assert/strict";

import { defaultSpellbook, defaultAbilities } from "../characters/CharacterTypes";
import { ABILITIES } from "../abilities/AbilityTypes";
import { grantAbilityInState } from "../abilities/AbilityLearning";
import { handleTrainCommand } from "../mud/commands/player/trainCommand";

function makeCtx(character: any, opts?: { withTrainer?: boolean }): any {
  const withTrainer = opts?.withTrainer !== false;
  const roomId = "prime_shard:0,0";
  const trainerEntity = {
    id: "npc_town_trainer",
    name: "Town Trainer",
    type: "npc",
    tags: ["trainer", "service_trainer", "protected_service"],
    x: 0,
    z: 0,
  };

  return {
    session: { character, roomId },
    entities: {
      getEntitiesInRoom: (rid: string) => (String(rid) === roomId && withTrainer ? [trainerEntity] : []),
    },
    sessions: {} as any,
    guilds: {} as any,
    characters: {} as any, // preview does not call characters.service methods
  };
}


function mkChar(classId: string, level = 1): any {
  return {
    id: "c1",
    userId: "u1",
    name: "Test",
    classId,
    level,
    pos: { x: 0, y: 0, z: 0 },
    spellbook: defaultSpellbook(),
    abilities: defaultAbilities(),
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickWarriorAbilityMinLevelAtLeast(minLevel: number): string {
  const ability = Object.values(ABILITIES).find(
    (a: any) => String(a?.classId ?? "").toLowerCase() === "warrior" && Number(a?.minLevel ?? 1) >= minLevel,
  ) as any;

  assert.ok(ability && ability.id, `Expected at least one warrior ability with minLevel>=${minLevel} in ABILITIES.`);
  return String(ability.id);
}

test("[contract] train preview abilities --why: includes error + rule hints", async () => {
  const old = process.env.WORLDCORE_TEST;
  process.env.WORLDCORE_TEST = "1";

  try {
    const abilityId = pickWarriorAbilityMinLevelAtLeast(3);
    const minLevel = Number((ABILITIES as any)[abilityId]?.minLevel ?? NaN);
    assert.ok(Number.isFinite(minLevel) && minLevel > 0, "Expected picked warrior ability to have a minLevel.");

    const c0 = mkChar("warrior", 1);
    const g = grantAbilityInState(c0 as any, abilityId, "test", 111);
    assert.equal(g.ok, true);

    const ctx = makeCtx((g as any).next);
    const out = await handleTrainCommand(ctx as any, ["preview", "abilities", "--why"]);

    assert.match(out, /Abilities blocked:/);
    assert.match(out, new RegExp(`\\(${escapeRegex(abilityId)}\\): level too low`));
    assert.match(out, new RegExp(`requires level\\s+${minLevel}`));
    assert.match(out, /\[why: /);
    assert.match(out, /error=level_too_low/);
  } finally {
    process.env.WORLDCORE_TEST = old;
  }
});
