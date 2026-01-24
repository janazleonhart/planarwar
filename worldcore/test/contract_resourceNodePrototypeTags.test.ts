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

type ScanState = {
  inSQuote: boolean;
  inDQuote: boolean;
  inTemplate: boolean;
  inLineComment: boolean;
  inBlockComment: boolean;
  escape: boolean;
};

function scanPrototypeObjectLiteral(src: string, id: string): string {
  const idNeedle = `id: "${id}"`;
  const idIdx = src.indexOf(idNeedle);
  assert.ok(idIdx >= 0, `NpcTypes.ts must define prototype '${id}'`);

  // Prefer the object key opener:  <id>: {
  let keyIdx = src.lastIndexOf(`${id}: {`, idIdx);
  let startIdx: number;

  if (keyIdx >= 0) {
    startIdx = src.indexOf("{", keyIdx);
  } else {
    // Fallback: nearest '{' before id field (best effort)
    startIdx = src.lastIndexOf("{", idIdx);
  }

  assert.ok(startIdx >= 0, `Failed to locate opening '{' for '${id}' prototype`);

  let depth = 0;
  const st: ScanState = {
    inSQuote: false,
    inDQuote: false,
    inTemplate: false,
    inLineComment: false,
    inBlockComment: false,
    escape: false,
  };

  for (let i = startIdx; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1] ?? "";

    // Handle comment states
    if (st.inLineComment) {
      if (c === "\n") st.inLineComment = false;
      continue;
    }
    if (st.inBlockComment) {
      if (c === "*" && n === "/") {
        st.inBlockComment = false;
        i++;
      }
      continue;
    }

    // Enter comments (only when not in string)
    const inString = st.inSQuote || st.inDQuote || st.inTemplate;
    if (!inString) {
      if (c === "/" && n === "/") {
        st.inLineComment = true;
        i++;
        continue;
      }
      if (c === "/" && n === "*") {
        st.inBlockComment = true;
        i++;
        continue;
      }
    }

    // Handle strings
    if (st.escape) {
      st.escape = false;
      continue;
    }
    if (inString && c === "\\") {
      st.escape = true;
      continue;
    }

    if (!st.inDQuote && !st.inTemplate && c === "'" ) {
      st.inSQuote = !st.inSQuote;
      continue;
    }
    if (!st.inSQuote && !st.inTemplate && c === '"' ) {
      st.inDQuote = !st.inDQuote;
      continue;
    }
    if (!st.inSQuote && !st.inDQuote && c === "`") {
      st.inTemplate = !st.inTemplate;
      continue;
    }

    // Brace tracking (only when not in string)
    if (!inString) {
      if (c === "{") depth++;
      if (c === "}") {
        depth--;
        if (depth === 0) {
          return src.slice(startIdx, i + 1);
        }
      }
    }
  }

  assert.fail(`Failed to find closing '}' for '${id}' prototype`);
}

function extractTagsFromPrototype(protoSrc: string): string[] {
  // Find tags: [ ... ] inside the prototype object literal.
  const m = protoSrc.match(/tags\s*:\s*\[([\s\S]*?)\]/m);
  assert.ok(m, "Prototype must define a tags: [...] array");

  const body = m[1] ?? "";
  const tags: string[] = [];
  const re = /"([^"]+)"/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(body))) tags.push(mm[1]);

  assert.ok(tags.length > 0, "tags array must include at least one string literal");
  return tags;
}

test("[contract] resource node prototypes must have correct resource_* subtype tag", () => {
  const root = findRepoRoot();
  const src = readAt(root, "worldcore/npc/NpcTypes.ts");

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

    const proto = scanPrototypeObjectLiteral(src, id);
    const tags = extractTagsFromPrototype(proto);

    assert.ok(
      tags.includes(expected),
      `Prototype '${id}' must include '${expected}'`
    );

    const others = RESOURCE_TAGS.filter((t) => t !== expected);
    for (const other of others) {
      assert.ok(
        !tags.includes(other),
        `Prototype '${id}' must not include '${other}'`
      );
    }
  }
});
