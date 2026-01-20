// worldcore/test/contract_killProgressionHookLivesInPerformNpcAttack.test.ts
//
// Contract: kill progression must be hooked in MudCombatActions.performNpcAttack,
// so spell kills (MudSpells -> MudActions -> performNpcAttack) advance kill quests too.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("[contract] performNpcAttack wires kill progression + reactions", () => {
  const compiled = path.join(__dirname, "..", "mud", "actions", "MudCombatActions.js");
  const src = fs.readFileSync(compiled, "utf8");

  const idx = src.indexOf("function performNpcAttack");
  assert.ok(idx >= 0, "Expected performNpcAttack(...) to exist in compiled MudCombatActions.js");

  const slice = src.slice(idx, idx + 6000);

  // Must detect kill via "You slay"
  assert.ok(
    slice.includes('includes("You slay")') || slice.includes("includes('You slay')"),
    'performNpcAttack must detect kills via result.includes("You slay")',
  );

  // Must record kill progression event
  assert.ok(
    slice.includes("applyProgressionEvent") &&
      (slice.includes('kind: "kill"') || slice.includes("kind:'kill'")),
    "performNpcAttack must apply a kill progression event (kind: 'kill')",
  );

  // Must react via MudProgressionHooks (tasks/titles/quests/rewards/patch)
  assert.ok(
    slice.includes("applyProgressionForEvent"),
    "performNpcAttack must call applyProgressionForEvent(...) on kill",
  );
});
