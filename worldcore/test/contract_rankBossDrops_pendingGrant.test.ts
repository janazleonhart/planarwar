// worldcore/test/contract_rankBossDrops_pendingGrant.test.ts
//
// Contract: Rank system v0.3 (boss drops)
// - Boss drop rules can be provided via PW_RANK_BOSS_DROPS_JSON (unit-test safe).
// - On a matching kill, if RNG passes, the player receives a *pending* grant.

import assert from "node:assert/strict";
import test from "node:test";

import { withRandomSequenceAsync } from "./testUtils";
import { applyRankBossDropGrantsForKill } from "../ranks/RankBossDropGrantService";

test("[contract] rank boss drops: env rules grant pending spell on kill", async () => {
  const oldEnv = process.env.PW_RANK_BOSS_DROPS_JSON;

  try {
    // Use an existing spell id from SpellTypes.ts so grantSpellInState can validate it.
    process.env.PW_RANK_BOSS_DROPS_JSON = JSON.stringify({
      spells: [
        {
          npcProtoId: "boss_dummy_proto",
          spellId: "archmage_arcane_bolt",
          chance: 1.0,
          source: "test",
        },
      ],
      abilities: [],
    });

    const ctx: any = {}; // no characters service needed for unit test
    const char: any = {
      userId: "u1",
      id: "c1",
      classId: "archmage",
      // leave spellbook/abilities empty; learning spine should be created by grantSpellInState.
      progression: {},
    };

    const res = await withRandomSequenceAsync([0], async () =>
      applyRankBossDropGrantsForKill(ctx, char, "boss_dummy_proto"),
    );

    assert.equal(res.snippets.length, 1, "Expected exactly one boss-drop snippet");
    assert.ok(
      (char.spellbook?.pending ?? {})["archmage_arcane_bolt"],
      "Expected spell to be present in spellbook.pending",
    );
    assert.ok(
      char.progression?.flags && typeof char.progression.flags === "object",
      "Expected progression.flags to exist",
    );
  } finally {
    process.env.PW_RANK_BOSS_DROPS_JSON = oldEnv;
  }
});
