// worldcore/test/contract_harvestProgressionHookWired.test.ts
//
// Contract: MudWorldActions must wire harvest progression + reactions, and must guard
// progression hook failures so harvesting never hard-fails due to quests/titles/tasks.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("[contract] harvest progression is wired + guarded in MudWorldActions", () => {
  // Tests run from dist/worldcore/test/*.js
  const compiled = path.join(__dirname, "..", "mud", "actions", "MudWorldActions.js");
  const src = fs.readFileSync(compiled, "utf8");

  // Must emit the generic progression event.
  assert.ok(
    src.includes("applyProgressionEvent") &&
      (src.includes('kind: "harvest"') || src.includes("kind:'harvest'")),
    "MudWorldActions must applyProgressionEvent(kind:'harvest')",
  );

  // Must run reactive hooks for harvest counters.
  assert.ok(
    src.includes("applyProgressionForEvent") &&
      (src.includes('"harvests"') || src.includes("'harvests'")),
    "MudWorldActions must call applyProgressionForEvent(..., 'harvests', ...)",
  );

  // Must guard progression hook failures (try/catch path).
  assert.ok(
    src.includes("applyProgressionForEvent (harvest) failed"),
    "MudWorldActions must guard harvest progression hooks with a non-fatal warning path",
  );
});
