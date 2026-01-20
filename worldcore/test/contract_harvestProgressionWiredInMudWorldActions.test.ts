// worldcore/test/contract_harvestProgressionWiredInMudWorldActions.test.ts
//
// Contract: harvest progression must be wired in MudWorldActions so gathering updates:
// - progression counters (harvests[nodeProtoId])
// - reactive hooks (tasks/titles/quests snippets)
//
// This locks down Harvest Progress v0 behavior and prevents regressions where harvesting
// stops advancing quests.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("[contract] MudWorldActions wires harvest progression + reactions", () => {
  const compiled = path.join(__dirname, "..", "mud", "actions", "MudWorldActions.js");
  const src = fs.readFileSync(compiled, "utf8");

  // Must emit a harvest progression event.
  assert.ok(
    src.includes("applyProgressionEvent") &&
      (src.includes('kind: "harvest"') || src.includes("kind:'harvest'")),
    "MudWorldActions must applyProgressionEvent(kind:'harvest')",
  );

  // Must key harvest reactions off the 'harvests' category (quests use harvest counters).
  assert.ok(
    src.includes("applyProgressionForEvent") &&
      (src.includes('"harvests"') || src.includes("'harvests'")),
    "MudWorldActions must call applyProgressionForEvent(..., 'harvests', ...)",
  );

  // Must append progression snippets to the output line (quest/task/title notices).
  assert.ok(
    src.includes("progressionSnippets") &&
      src.includes("progressionSnippets.length") &&
      src.includes("progressionSnippets.join"),
    "MudWorldActions must append progressionSnippets to output",
  );
});
