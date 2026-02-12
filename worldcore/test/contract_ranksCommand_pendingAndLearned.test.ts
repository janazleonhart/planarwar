// worldcore/test/contract_ranksCommand_pendingAndLearned.test.ts
//
// Contract: ranks command
// - Shows pending grants
// - Shows learned rank upgrades (rank > 1)

import assert from "node:assert/strict";
import test from "node:test";

import { withRandomSequenceAsync } from "./testUtils";
import { applyRankBossDropGrantsForKill } from "../ranks/RankBossDropGrantService";
import { handleRanksCommand } from "../mud/commands/player/ranksCommand";

function makeTestCtx(character: any): any {
  return {
    session: { character },
    // Required by MudContext typing, but not used by this test path.
    sessions: {} as any,
    guilds: {} as any,
  };
}

test("[contract] ranks command: shows pending grants", async () => {
  const oldEnv = process.env.PW_RANK_BOSS_DROPS_JSON;

  try {
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

    const char: any = {
      userId: "u1",
      id: "c1",
      classId: "archmage",
      progression: {},
      spellbook: { known: {}, pending: {} },
      abilities: { known: {}, pending: {} },
    };

    const ctx = makeTestCtx(char);

    await withRandomSequenceAsync([0], async () =>
      applyRankBossDropGrantsForKill(ctx, char, "boss_dummy_proto"),
    );

    const out = await handleRanksCommand(ctx, []);

    assert.match(out, /Spells pending training:/);
    assert.match(out, /archmage_arcane_bolt/);
    assert.match(out, /Tip: use `train`/);
  } finally {
    process.env.PW_RANK_BOSS_DROPS_JSON = oldEnv;
  }
});
