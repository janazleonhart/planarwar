// worldcore/tools/schemaAppliedMissingAudit.ts
//
// Reports migrations that are recorded as applied in the database, but missing on disk.
// This is a companion to applySchema's hard-guard.
//
// Usage:
//   node dist/worldcore/tools/schemaAppliedMissingAudit.js
//   node dist/worldcore/tools/schemaAppliedMissingAudit.js --dir worldcore/infra/schema
//
// Exit codes:
//   0 - OK (no missing migrations)
//   1 - unexpected error
//   2 - missing migrations found

import fs from "node:fs";
import path from "node:path";

import { db } from "../db/Database";
import { Logger } from "../utils/logger";
import { listSchemaMigrationFiles } from "./schemaMigrationLib";
import {
  loadSchemaMissingIgnoreList,
  computeAppliedMissingOnDisk,
  SCHEMA_IGNORE_JSON,
  SCHEMA_IGNORE_TXT,
} from "./schemaMissingMigrationsLib";

type Args = { dir: string };

function parseArgs(argv: string[]): Args {
  const out: Args = { dir: path.resolve(process.cwd(), "worldcore/infra/schema") };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--dir") {
      const next = argv[i + 1];
      if (!next) throw new Error("Missing value for --dir");
      out.dir = path.resolve(process.cwd(), next);
      i++;
      continue;
    }
    if (a === "--help" || a === "-h") {
      console.log(
        `schemaAppliedMissingAudit\n\nUsage:\n  node dist/worldcore/tools/schemaAppliedMissingAudit.js [--dir <path>]\n`.trim(),
      );
      process.exit(0);
    }
    throw new Error(`Unknown arg: ${a}`);
  }

  return out;
}

async function getAppliedIds(): Promise<string[]> {
  const res = await db.query(`SELECT id FROM schema_migrations ORDER BY applied_at ASC;`);
  const out: string[] = [];
  for (const row of res.rows as any[]) {
    if (!row?.id) continue;
    out.push(String(row.id));
  }
  return out;
}

async function main(): Promise<void> {
  const log = Logger.scope("SCHEMA_AUDIT");
  const args = parseArgs(process.argv);

  const schemaDir = args.dir;
  if (!fs.existsSync(schemaDir)) {
    log.error("Schema directory does not exist:", schemaDir);
    process.exit(1);
  }

  const diskIds = listSchemaMigrationFiles(schemaDir);
  const appliedIds = await getAppliedIds();
  const ignore = loadSchemaMissingIgnoreList(schemaDir);

  const missing = computeAppliedMissingOnDisk({ appliedIds, diskIds, ignoreIds: ignore });
  if (missing.length === 0) {
    log.success("OK: no applied migrations are missing on disk.");
    return;
  }

  log.warn("Applied migrations missing on disk:");
  for (const id of missing) log.warn(" -", id);

  if (ignore.size === 0) {
    log.info(`Tip: allow-list intentionally retired migrations via ${SCHEMA_IGNORE_JSON} or ${SCHEMA_IGNORE_TXT} in ${schemaDir}.`);
  }

  process.exit(2);
}

main()
  .then(async () => {
    try {
      const anyDb: any = db as any;
      if (typeof anyDb?.end === "function") await anyDb.end();
    } catch {
      // ignore
    }
    process.exit(0);
  })
  .catch(async (err) => {
    try {
      const anyDb: any = db as any;
      if (typeof anyDb?.end === "function") await anyDb.end();
    } catch {
      // ignore
    }
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
