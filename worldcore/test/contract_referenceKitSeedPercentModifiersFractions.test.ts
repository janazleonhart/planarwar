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

const REFERENCE_KIT_SEED_FILES = [
  "050_seed_reference_class_kits_L1_10.sql",
  "056_seed_crusader_class_kit_L1_10.sql",
  "056_seed_crusader_spellkit_L1_10.sql",
  "057_seed_hunter_spellkit_L1_10.sql",
  "059_seed_illusionist_spellkit_L1_10.sql",
  "059_seed_runic_knight_spellkit_L1_10.sql",
  "060_seed_ascetic_spellkit_L1_10.sql",
  "061_seed_prophet_spellkit_L1_10.sql",
  "062_seed_hierophant_spellkit_L1_10.sql",
  "063_seed_revenant_spellkit_L1_10.sql",
  "064_seed_outrider_spellkit_L1_10.sql",
] as const;

function readSeed(fileName: string): string {
  const schemaDir = resolveSchemaDir();
  return fs.readFileSync(path.join(schemaDir, fileName), "utf8");
}

const MODIFIER_PATTERN = /"(damageTakenPct|damageDealtPct)"\s*:\s*(-?\d+(?:\.\d+)?)/g;

test("reference-kit seed SQL keeps percent modifiers in fractional form", () => {
  const offenders: string[] = [];

  for (const fileName of REFERENCE_KIT_SEED_FILES) {
    const sql = readSeed(fileName);

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

  assert.deepEqual(offenders, [], offenders.join("\n"));
});
