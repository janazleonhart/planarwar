//worldcore/test/contract_classId_runtimeNormalization.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeRuntimeClassId,
  normalizeRuntimeCharacterClassInPlace,
} from "../classes/ClassId";

test("[contract] runtime class id normalization strips pw_class_ prefix", () => {
  assert.equal(normalizeRuntimeClassId("pw_class_warlord"), "warlord");
  assert.equal(normalizeRuntimeClassId("PW_CLASS_ASCETIC"), "ascetic");
  assert.equal(normalizeRuntimeClassId("pwclass_hunter"), "hunter");
  assert.equal(normalizeRuntimeClassId("warlock"), "warlock");
  assert.equal(normalizeRuntimeClassId(""), "");
});

test("[contract] runtime class normalization mutates attached character state in place", () => {
  const char: any = { classId: "pw_class_revenant" };
  const out = normalizeRuntimeCharacterClassInPlace(char);
  assert.equal(out, char);
  assert.equal(char.classId, "revenant");
});
