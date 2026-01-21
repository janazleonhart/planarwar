// worldcore/test/contract_songScaling.test.ts
//
// Contract tests for SongScaling (central song potency math).
// Uses node:test like the rest of the suite.

import assert from "node:assert/strict";
import test from "node:test";

import {
  computeSongScalarFromSkill,
  computeSongScalar,
  scaleSongHealFloor,
} from "../songs/SongScaling";

test("[contract] SongScaling scalar is deterministic and clamps negatives", () => {
  assert.equal(computeSongScalarFromSkill(0), 1);
  assert.equal(computeSongScalarFromSkill(50), 1.5);
  assert.equal(computeSongScalarFromSkill(-10), 1, "Negative skills should not reduce below 1");
});

test("[contract] SongScaling reads song school skill from character progression", () => {
  const char: any = {
    level: 1,
    progression: {
      skills: {
        songs: {
          voice: 50,
        },
      },
    },
  };

  const scalar = computeSongScalar(char, "voice");
  assert.equal(scalar, 1.5);
});

test("[contract] SongScaling healing uses floor(base * scalar)", () => {
  const char: any = {
    level: 1,
    progression: {
      skills: {
        songs: {
          voice: 50, // scalar 1.5
        },
      },
    },
  };

  assert.equal(scaleSongHealFloor(10, char, "voice"), 15);
  assert.equal(scaleSongHealFloor(11, char, "voice"), 16, "floor(11*1.5)=16.5 -> 16");
});

test("[contract] SongScaling is safe when character has no progression blob", () => {
  const char: any = { level: 1 };
  const scalar = computeSongScalar(char, "voice");
  assert.equal(scalar, 1, "Missing progression should behave like skill 0");
});
