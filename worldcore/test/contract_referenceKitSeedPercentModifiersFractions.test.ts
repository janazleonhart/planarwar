// worldcore/test/contract_referenceKitSeedPercentModifiersFractions.test.ts

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

const MODIFIER_PATTERN = /"(damageTakenPct|damageDealtPct)"\s*:\s*(-?\d+(?:\.\d+)?)/g;

function looksLikeReferenceKitSeed(sql: string): boolean {
  return (
    /INSERT\s+INTO\s+public\.spells/i.test(sql) &&
    /(reference_kit|ref_l1_10|reference-kit)/i.test(sql)
  );
}

test("reference-kit seed SQL keeps percent modifiers in fractional form", () => {
  const offenders: string[] = [];
  const scannedFiles: string[] = [];

  for (const { fileName, sql } of readSqlFiles()) {
    if (!looksLikeReferenceKitSeed(sql)) continue;
    scannedFiles.push(fileName);

    for (const match of sql.matchAll(MODIFIER_PATTERN)) {
      const modifierName = match[1];
      const rawValue = Number(match[2]);
      if (!Number.isFinite(rawValue)) {
        offenders.push(`${fileName}: ${modifierName}=${match[2]} is not a finite number`);
        continue;
      }

      if (rawValue === 0) {
        offenders.push(`${fileName}: ${modifierName}=0 should not be encoded as a percent modifier`);
        continue;
      }

      if (Math.abs(rawValue) > 1) {
        offenders.push(
          `${fileName}: ${modifierName}=${rawValue} must be fractional (e.g. 0.08, -0.10, -1.0)`,
        );
      }
    }
  }

  assert.ok(scannedFiles.length > 0, "expected to discover at least one reference-kit seed SQL file");
  assert.deepEqual(offenders, [], offenders.join("\n"));
});
