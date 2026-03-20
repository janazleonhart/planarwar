//worldcore/test/contract_spellSeedTagsColumnTyping.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function resolveSchemaDir(): string {
  const candidates = [
    path.resolve(__dirname, "../infra/schema"),
    path.resolve(__dirname, "../../worldcore/infra/schema"),
    path.resolve(process.cwd(), "infra/schema"),
    path.resolve(process.cwd(), "worldcore/infra/schema"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`Unable to locate worldcore/infra/schema from ${__dirname}`);
}

function readSqlFiles(): Array<{ fileName: string; sql: string }> {
  const schemaDir = resolveSchemaDir();
  return fs
    .readdirSync(schemaDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((fileName) => ({
      fileName,
      sql: fs.readFileSync(path.join(schemaDir, fileName), "utf8"),
    }));
}

test("spell seed SQL never encodes public.spells tags as jsonb arrays", () => {
  const offenders: string[] = [];

  for (const { fileName, sql } of readSqlFiles()) {
    if (!/INSERT\s+INTO\s+public\.spells/i.test(sql)) continue;

    if (/to_jsonb\s*\(\s*ARRAY\s*\[/i.test(sql)) {
      offenders.push(`${fileName}: uses to_jsonb(ARRAY[ for public.spells tags payloads`);
    }

    if (/'\[[^\n]*\]'::jsonb/i.test(sql)) {
      offenders.push(`${fileName}: uses JSON array literal cast for public.spells tags payloads`);
    }
  }

  assert.deepEqual(offenders, [], offenders.join("\n"));
});
