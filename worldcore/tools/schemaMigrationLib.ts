// worldcore/tools/schemaMigrationLib.ts
// Shared helpers for schema migration tooling.
//
// "Data migration hygiene" means we do not silently allow schema history to mutate.
// Once a migration file has been applied, editing it should be treated as a hard error.

import fs from "node:fs";
import crypto from "node:crypto";

/**
 * Returns true if the filename is considered a schema migration file.
 * Convention: 3-digit prefix + underscore + name + .sql
 */
export function isSchemaMigrationFilename(name: string): boolean {
  return /^\d{3}_.+\.sql$/i.test(name);
}

/**
 * List schema migration filenames in deterministic order (lexicographic).
 * Matches applySchema.ts behavior.
 */
export function listSchemaMigrationFiles(schemaDir: string): string[] {
  if (!fs.existsSync(schemaDir)) return [];

  return fs
    .readdirSync(schemaDir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter(isSchemaMigrationFilename)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Compute sha256(text) as a lowercase hex string.
 */
export function computeSha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Compute sha256(file contents) as lowercase hex.
 */
export function computeFileSha256Hex(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}
