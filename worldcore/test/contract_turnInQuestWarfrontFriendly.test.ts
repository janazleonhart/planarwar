// worldcore/test/contract_turnInQuestWarfrontFriendly.test.ts
//
// Contract: quest turn-in is warfront-friendly.
// - turnInQuest keeps the legacy blank prompt.
// - supports 'list'/'ready' to show completed quests.
// - supports numeric index <#> into quest log ordering.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("[contract] turnInQuest supports list/ready + numeric index + keeps legacy prompt", () => {
  const compiled = path.join(__dirname, "..", "quests", "turnInQuest.js");
  const src = fs.readFileSync(compiled, "utf8");

  // Legacy blank input prompt must remain stable.
  assert.ok(
    src.includes("Turn in which quest?"),
    "turnInQuest must keep legacy blank-arg prompt",
  );

  // Must sort questState keys for stable quest-log ordering.
  assert.ok(
    src.includes("Object.keys(questState).sort()"),
    "turnInQuest must derive a stable quest ordering via Object.keys(questState).sort()",
  );

  // Must support list/ready helpers.
  assert.ok(
    src.includes('lower === "list"') || src.includes("lower === 'list'"),
    "turnInQuest must support 'list'",
  );
  assert.ok(
    src.includes('lower === "ready"') || src.includes("lower === 'ready'"),
    "turnInQuest must support 'ready'",
  );

  // Must support numeric index selection.
  assert.ok(
    src.includes("/^\\d+\$/.test(trimmed)") || src.includes("/^\\d+\$/.test"),
    "turnInQuest must support numeric index selection",
  );

  // Must distinguish not-accepted quests.
  assert.ok(
    src.includes("You have not accepted"),
    "turnInQuest must explicitly tell the player when a quest is not accepted",
  );
});
