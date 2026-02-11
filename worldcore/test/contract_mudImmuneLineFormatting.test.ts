// worldcore/test/contract_mudImmuneLineFormatting.test.ts
//
// Contract: "target is immune" lines stay stable across spells/abilities.

import test from "node:test";
import assert from "node:assert/strict";

import { formatTargetImmuneLine } from "../mud/MudLines";

test("[contract] immune line formatting is stable", () => {
  assert.equal(formatTargetImmuneLine(), "[world] Target is immune.");

  assert.equal(
    formatTargetImmuneLine({ kind: "spell", name: "Arcane Lock" }),
    "[world] [spell:Arcane Lock] Target is immune.",
  );

  // Whitespace safety: name is trimmed.
  assert.equal(
    formatTargetImmuneLine({ kind: "spell", name: "  Mez  " }),
    "[world] [spell:Mez] Target is immune.",
  );
});
