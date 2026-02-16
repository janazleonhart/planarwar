// worldcore/test/contract_questCommandHelpMentionsBoardFiltersAndActions.test.ts
//
// Contract: quest command help must advertise quest board filters + board-scoped actions.
// This prevents UX regressions where features exist but players can't discover them.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("[contract] quest help mentions board filters + board-scoped actions", () => {
  const compiled = path.join(__dirname, "..", "mud", "commands", "progression", "questsCommand.js");
  const src = fs.readFileSync(compiled, "utf8");

  assert.ok(src.includes("quest board help"), "Help must mention: quest board help");
  assert.ok(src.includes("quest board available"), "Help must mention: quest board available");
  assert.ok(src.includes("quest board new"), "Help must mention: quest board new");
  assert.ok(src.includes("quest board active"), "Help must mention: quest board active");
  assert.ok(src.includes("quest board ready"), "Help must mention: quest board ready");
  assert.ok(src.includes("quest board turned"), "Help must mention: quest board turned");

  // Board-scoped actions
  assert.ok(
    src.includes("quest board show <#|id|name>"),
    "Help must mention: quest board show <#|id|name>",
  );
  assert.ok(
    src.includes("quest board accept <#|id|name>"),
    "Help must mention: quest board accept <#|id|name>",
  );
});
