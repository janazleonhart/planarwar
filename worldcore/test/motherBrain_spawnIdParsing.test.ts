import assert from "node:assert/strict";
import test from "node:test";

import { parseBrainSpawnId, summarizeBrainSpawns } from "../tools/motherBrain";

test("parseBrainSpawnId: extracts theme + epoch from common patterns", () => {
  // canonical-ish: brain:wave:<theme>:<epoch>:...
  {
    const info = parseBrainSpawnId("brain:wave:goblins:0:0,0:3");
    assert.equal(info.theme, "goblins");
    assert.equal(info.epoch, 0);
  }

  // alternative: brain:<theme>:<epoch>:...
  {
    const info = parseBrainSpawnId("brain:bandits:12:x");
    assert.equal(info.theme, "bandits");
    assert.equal(info.epoch, 12);
  }

  // unknown theme but epoch exists
  {
    const info = parseBrainSpawnId("brain:weird:7:x");
    assert.equal(info.theme, null);
    assert.equal(info.epoch, 7);
  }

  // theme exists, no epoch token
  {
    const info = parseBrainSpawnId("brain:ore:foo:bar");
    assert.equal(info.theme, "ore");
    assert.equal(info.epoch, null);
  }
});

test("summarizeBrainSpawns: counts by theme/epoch/type/proto", () => {
  const rows = [
    {
      spawnId: "brain:wave:goblins:0:a",
      type: "npc",
      archetype: "mob",
      protoId: "npc_goblin",
      variantId: null,
      regionId: "prime_shard:0,0",
      x: 0,
      z: 0,
    },
    {
      spawnId: "brain:wave:goblins:0:b",
      type: "npc",
      archetype: "mob",
      protoId: "npc_goblin",
      variantId: null,
      regionId: "prime_shard:0,0",
      x: 1,
      z: 1,
    },
    {
      spawnId: "brain:bandits:1:c",
      type: "npc",
      archetype: "mob",
      protoId: "npc_bandit",
      variantId: null,
      regionId: "prime_shard:0,0",
      x: 2,
      z: 2,
    },
  ];

  const s = summarizeBrainSpawns(rows);
  assert.equal(s.total, 3);
  assert.equal(s.byTheme.goblins, 2);
  assert.equal(s.byTheme.bandits, 1);
  assert.equal(s.byEpoch["0"], 2);
  assert.equal(s.byEpoch["1"], 1);
  assert.equal(s.byType.npc, 3);
  assert.equal(s.byProtoId.npc_goblin, 2);
  assert.equal(s.byProtoId.npc_bandit, 1);
});
