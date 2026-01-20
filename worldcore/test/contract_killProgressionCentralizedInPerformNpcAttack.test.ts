// worldcore/test/contract_killProgressionCentralizedInPerformNpcAttack.test.ts
//
// Contract: kill progression (kills -> tasks/titles/quests) must be centralized in performNpcAttack,
// so BOTH melee attacks and spell damage routes trigger the same progression behavior.
// This prevents the classic bug: "quests only progress when you kill via the /attack command".

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("[contract] performNpcAttack centralizes kill progression hooks (no per-caller kill parsing)", () => {
  // Tests run from: dist/worldcore/test/*.js
  // We intentionally read the compiled JS so the test runner doesn't depend on TS sources existing in dist.
  const compiled = path.join(__dirname, "..", "mud", "actions", "MudCombatActions.js");
  const src = fs.readFileSync(compiled, "utf8");

  const idx = src.indexOf("function performNpcAttack");
  assert.ok(idx >= 0, "Expected performNpcAttack(...) to exist in compiled MudCombatActions.js");

  const slice = src.slice(idx, idx + 4000);

  // Must detect kills via the stable combat text ("You slay ...").
  assert.ok(
    slice.includes('includes("You slay")') || slice.includes("includes('You slay')"),
    'performNpcAttack must detect kills via result.includes("You slay")',
  );

  // Must emit the kill progression event.
  assert.ok(
    slice.includes("applyProgressionEvent") && (slice.includes('kind: "kill"') || slice.includes("kind:'kill'")),
    "performNpcAttack must apply a kill progression event (kind: 'kill')",
  );

  // Must react to progression (tasks/titles/quests + DB patch snippets).
  assert.ok(slice.includes("applyProgressionForEvent"), "performNpcAttack must react via applyProgressionForEvent(...)");
});
