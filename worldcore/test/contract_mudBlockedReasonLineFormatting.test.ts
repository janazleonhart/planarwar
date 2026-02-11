// worldcore/test/contract_mudBlockedReasonLineFormatting.test.ts
//
// Contract: blockedReason -> user-facing line mapping stays stable.

import test from "node:test";
import assert from "node:assert/strict";

import { formatBlockedReasonLine } from "../mud/MudBlockReasons";

test("[contract] blockedReason line mapping is stable", () => {
  assert.equal(
    formatBlockedReasonLine({ reason: "cc_dr_immune" }),
    "[world] Target is immune.",
  );

  assert.equal(
    formatBlockedReasonLine({ reason: "cc_dr_immune", kind: "spell", name: "Mez" }),
    "[world] [spell:Mez] Target is immune.",
  );

  // Unknown reasons should not crash or leak raw codes.
  assert.equal(
    formatBlockedReasonLine({ reason: "some_future_reason", kind: "spell", name: "Weirdness" }),
    "[world] It fails.",
  );
});
