// worldcore/test/contract_crusaderPrimaryResource_mana.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { CLASS_DEFINITIONS } from "../classes/ClassDefinitions";

test("[contract] crusader primary power resource is mana", () => {
  assert.equal(CLASS_DEFINITIONS.crusader.primaryResource, "mana");
});
