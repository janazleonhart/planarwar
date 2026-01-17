// worldcore/test/spawnAuthority.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  getSpawnAuthority,
  isSpawnEditable,
  isSpawnAnchor,
  isSpawnSeed,
  isSpawnBrain,
} from "../world/spawnAuthority";

test("[unit] spawnAuthority parses prefixes", () => {
  assert.equal(getSpawnAuthority("anchor:foo"), "anchor");
  assert.equal(getSpawnAuthority("seed:bar"), "seed");
  assert.equal(getSpawnAuthority("brain:baz"), "brain");
  assert.equal(getSpawnAuthority("checkpoint_gap_8_8"), "manual");

  // case/whitespace defensive
  assert.equal(getSpawnAuthority("  ANCHOR:TownRat  "), "anchor");
  assert.equal(getSpawnAuthority(" SeEd:Thing "), "seed");
  assert.equal(getSpawnAuthority(" BRAIN:xyz "), "brain");
});

test("[contract] brain-owned spawn points are not editable", () => {
  assert.equal(isSpawnEditable("brain:camp:123"), false);
  assert.equal(isSpawnEditable("anchor:camp:123"), true);
  assert.equal(isSpawnEditable("seed:camp:123"), true);
  assert.equal(isSpawnEditable("checkpoint_gap_8_8"), true);

  assert.equal(isSpawnBrain("brain:aaa"), true);
  assert.equal(isSpawnAnchor("anchor:aaa"), true);
  assert.equal(isSpawnSeed("seed:aaa"), true);
});
