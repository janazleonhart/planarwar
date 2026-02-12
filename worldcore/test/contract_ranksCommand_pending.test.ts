// worldcore/test/contract_ranksCommand_pending.test.ts
//
// Contract: ranks command shows pending training items.

import assert from "node:assert/strict";
import test from "node:test";

import { handleRanksCommand } from "../mud/commands/player/ranksCommand";

test("[contract] ranks: lists pending spells/abilities", async () => {
  const ctx: any = {
    session: {
      character: {
        spellbook: {
          pending: {
            archmage_arcane_bolt: { source: "test" },
          },
        },
        abilities: {
          pending: {
            warrior_slam: { source: "test" },
          },
        },
      },
    },
  };

  const out = await handleRanksCommand(ctx, []);

  assert.ok(out.includes("Spells pending training"), "Expected spells pending section");
  assert.ok(out.includes("Abilities pending training"), "Expected abilities pending section");
  assert.ok(out.includes("archmage_arcane_bolt"), "Expected pending spell id");
  assert.ok(out.includes("warrior_slam"), "Expected pending ability id");
});
