// worldcore/test/contract_questsCommandHelpMentionsTurninListIndex.test.ts
//
// Contract: quest command help must advertise warfront-friendly turn-in UX.
// - 'quest turnin list' / 'ready'
// - 'quest turnin <#|id|name>'
//
// This prevents regressions where turn-in supports these features but the help text hides them.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("[contract] questsCommand help mentions turnin list/ready + numeric index", () => {
  const compiled = path.join(__dirname, "..", "mud", "commands", "progression", "questsCommand.js");
  const src = fs.readFileSync(compiled, "utf8");

  assert.ok(
    src.includes("quest turnin list"),
    "Help must mention: quest turnin list",
  );

  assert.ok(
    src.includes("quest turnin ready"),
    "Help must mention: quest turnin ready",
  );

  // Numeric index + id + name
  assert.ok(
    src.includes("quest turnin <#|id|name>") || src.includes("turnin <#|id|name>"),
    "Help must mention: quest turnin <#|id|name>",
  );
});
