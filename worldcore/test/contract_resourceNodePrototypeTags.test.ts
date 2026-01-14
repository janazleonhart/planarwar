import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function findRepoRoot(): string {
  const candidates = [
    path.resolve(__dirname, "../../.."),
    path.resolve(__dirname, "../../../.."),
  ];

  for (const root of candidates) {
    const p = path.join(root, "worldcore", "npc", "NpcTypes.ts");
    if (fs.existsSync(p)) return root;
  }

  return candidates[0];
}

function readAt(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function expectedTagFromId(id: string): string | null {
  if (id.startsWith("ore_")) return "resource_ore";
  if (id.startsWith("herb_")) return "resource_herb";
  if (id.startsWith("wood_")) return "resource_wood";
  if (id.startsWith("stone_")) return "resource_stone";
  if (id.startsWith("fish_")) return "resource_fish";
  if (id.startsWith("grain_")) return "resource_grain";
  if (id.startsWith("mana_")) return "resource_mana";
  return null;
}

const RESOURCE_TAGS = [
  "resource_ore",
  "resource_herb",
  "resource_wood",
  "resource_stone",
  "resource_fish",
  "resource_grain",
  "resource_mana",
];

test("[contract] resource node prototypes must have correct resource_* subtype tag", () => {
  const root = findRepoRoot();
  const src = readAt(root, "worldcore/npc/NpcTypes.ts");

  // Cheap static checks: ensure each starter node includes its expected resource tag.
  const starterNodeIds = [
    "herb_peacebloom",
    "ore_iron_hematite",
    "stone_granite",
    "wood_oak",
    "fish_river_trout",
    "grain_wheat",
    "mana_spark_arcane",
  ];

  for (const id of starterNodeIds) {
    const expected = expectedTagFromId(id);
    assert.ok(expected, `Expected resource tag for '${id}'`);

    // Find a small window around the prototype id and ensure the expected tag appears.
    const idx = src.indexOf(`id: "${id}"`);
    assert.ok(idx >= 0, `NpcTypes.ts must define prototype '${id}'`);

    const window = src.slice(Math.max(0, idx - 200), Math.min(src.length, idx + 600));
    assert.ok(
      window.includes(expected),
      `Prototype '${id}' must include '${expected}'`
    );

    // Ensure we don't accidentally include a different resource subtype in that same window.
    const others = RESOURCE_TAGS.filter((t) => t !== expected);
    for (const other of others) {
      assert.ok(
        !window.includes(other),
        `Prototype '${id}' must not include '${other}'`
      );
    }
  }
});
