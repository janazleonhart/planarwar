// worldcore/tools/applySchema.ts
//
// Apply worldcore/infra/schema/*.sql in numeric order, once each.
// Tracks applied files in schema_migrations.
//
// Logging:
// - Uses worldcore Logger (console)
// - If PW_FILELOG is set AND mmo-backend/FileLogTap exists, we install it dynamically.
//   This avoids TypeScript rootDir issues (no cross-package import).
//
// Usage:
//   PW_FILELOG=/home/rimuru/planarwar/logs/planarwar-{scope}.log node dist/worldcore/tools/applySchema.js
//   node dist/worldcore/tools/applySchema.js --dry-run
//   node dist/worldcore/tools/applySchema.js --only 030_trade_recipes.sql
//   node dist/worldcore/tools/applySchema.js --dir worldcore/infra/schema

import fs from "fs";
import path from "path";

import { db } from "../db/Database";
import { Logger } from "../utils/logger";
import {
  listSchemaMigrationFiles,
  computeFileSha256Hex,
} from "./schemaMigrationLib";

type Args = {
  dir: string;
  dryRun: boolean;
  only?: string;
};

function tryInstallFileLogTap(log: any): void {
  // Only attempt if the env is set (otherwise, why bother)
  if (!process.env.PW_FILELOG) return;

  // Dynamic require avoids TS rootDir issues.
  // We try a couple of likely locations:
  // - repo root: ./mmo-backend/FileLogTap
  // - dist runtime: dist/mmo-backend/FileLogTap (if your dev runner compiles it)
  //
  // Note: require() paths are resolved relative to this compiled file at runtime,
  // so we use process.cwd() (repo root) for stability.
  const candidates = [
    path.resolve(process.cwd(), "mmo-backend", "FileLogTap"),
    path.resolve(process.cwd(), "mmo-backend", "FileLogTap.ts"),
    path.resolve(process.cwd(), "dist", "mmo-backend", "FileLogTap"),
    path.resolve(process.cwd(), "dist", "mmo-backend", "FileLogTap.js"),
  ];

  for (const p of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(p);
      const fn =
        mod?.installFileLogTap ??
        mod?.default?.installFileLogTap ??
        mod?.default ??
        null;

      if (typeof fn === "function") {
        fn();
        log.info("FileLogTap installed from:", p);
        return;
      }
    } catch {
      // keep trying
    }
  }

  log.warn("PW_FILELOG is set, but FileLogTap could not be loaded from mmo-backend. Continuing without file tap.");
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    dir: path.resolve(process.cwd(), "worldcore/infra/schema"),
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (a === "--dir") {
      const next = argv[i + 1];
      if (!next) throw new Error("Missing value for --dir");
      out.dir = path.resolve(process.cwd(), next);
      i++;
      continue;
    }
    if (a === "--only") {
      const next = argv[i + 1];
      if (!next) throw new Error("Missing value for --only");
      out.only = next;
      i++;
      continue;
    }
    if (a === "--help" || a === "-h") {
      printHelpAndExit(0);
    }

    throw new Error(`Unknown arg: ${a}`);
  }

  return out;
}

function printHelpAndExit(code: number): never {
  console.log(
    `
applySchema

Applies SQL files under worldcore/infra/schema in numeric order and records them in schema_migrations.

Usage:
  node dist/worldcore/tools/applySchema.js [--dry-run] [--dir <path>] [--only <file.sql>]

Examples:
  PW_FILELOG=/home/rimuru/planarwar/logs/planarwar-{scope}.log node dist/worldcore/tools/applySchema.js
  node dist/worldcore/tools/applySchema.js --dry-run
  node dist/worldcore/tools/applySchema.js --only 030_trade_recipes.sql
`.trim(),
  );
  process.exit(code);
}

function listSchemaFiles(schemaDir: string): string[] {
  return listSchemaMigrationFiles(schemaDir);
}

async function ensureMigrationsTable(log: any): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      checksum   TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Backward compat for older installs that created the table without checksum.
  await db.query(`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT;`);

  log.info("Ensured schema_migrations table exists.");
}

type AppliedRow = { id: string; checksum: string | null };

async function getAppliedRows(): Promise<AppliedRow[]> {
  const res = await db.query(`SELECT id, checksum FROM schema_migrations ORDER BY applied_at ASC;`);
  const out: AppliedRow[] = [];
  for (const row of res.rows as any[]) {
    if (!row?.id) continue;
    out.push({ id: String(row.id), checksum: row?.checksum ? String(row.checksum) : null });
  }
  return out;
}

async function driftCheckAppliedFiles(params: {
  log: any;
  schemaDir: string;
  applied: AppliedRow[];
}): Promise<void> {
  const { log, schemaDir, applied } = params;

  const allowDrift = process.env.PW_SCHEMA_ALLOW_DRIFT === "1";
  const filesOnDisk = new Set(listSchemaFiles(schemaDir));

  for (const row of applied) {
    if (!filesOnDisk.has(row.id)) continue; // deleted/renamed file: we can't validate

    const fullPath = path.join(schemaDir, row.id);
    const current = computeFileSha256Hex(fullPath);

    // First-run on old DBs: set checksum without failing.
    if (!row.checksum) {
      await db.query(`UPDATE schema_migrations SET checksum=$1 WHERE id=$2`, [current, row.id]);
      continue;
    }

    if (row.checksum !== current) {
      const msg =
        `Schema migration drift detected for ${row.id}.\n` +
        `- recorded checksum: ${row.checksum}\n` +
        `- current checksum:  ${current}\n` +
        `\nDo NOT edit applied migrations. Create a new migration instead.`;

      if (allowDrift) {
        log.warn(msg);
        continue;
      }

      log.error(msg);
      throw new Error("Schema migration drift detected");
    }
  }
}

async function applyOneFile(params: {
  log: any;
  schemaDir: string;
  filename: string;
  dryRun: boolean;
}): Promise<void> {
  const { log, schemaDir, filename, dryRun } = params;

  const fullPath = path.join(schemaDir, filename);
  const sql = fs.readFileSync(fullPath, "utf-8");
  const checksum = computeFileSha256Hex(fullPath);

  log.info(`Applying ${filename} (${sql.length} bytes)...`);

  if (dryRun) {
    log.info(`[dry-run] Skipping execution for ${filename}`);
    return;
  }

  await db.query("BEGIN");
  try {
    await db.query(sql);
    await db.query(`INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)`, [filename, checksum]);
    await db.query("COMMIT");
    log.success(`Applied ${filename}`);
  } catch (err: any) {
    await db.query("ROLLBACK");
    log.error(`FAILED ${filename}`, { err: String(err?.message ?? err) });
    throw err;
  }
}

async function main(): Promise<void> {
  const log = Logger.scope("SCHEMA");
  tryInstallFileLogTap(log);

  let args: Args;
  try {
    args = parseArgs(process.argv);
  } catch (e: any) {
    log.error(String(e?.message ?? e));
    printHelpAndExit(1);
  }

  const schemaDir = args.dir;

  log.info("Schema dir:", schemaDir);
  if (!fs.existsSync(schemaDir)) {
    log.error("Schema directory does not exist:", schemaDir);
    process.exit(2);
  }

  await ensureMigrationsTable(log);

  const files = listSchemaFiles(schemaDir);
  if (files.length === 0) {
    log.warn("No schema files found.");
    return;
  }

  const appliedRows = await getAppliedRows();
  await driftCheckAppliedFiles({ log, schemaDir, applied: appliedRows });

  const appliedSet = new Set(appliedRows.map((r) => r.id));
  let plan = files.filter((f) => !appliedSet.has(f));

  if (args.only) {
    if (!files.includes(args.only)) {
      log.error(`--only file not found in schema dir: ${args.only}`);
      process.exit(3);
    }
    if (appliedSet.has(args.only)) {
      log.info(`--only file already applied: ${args.only}`);
      return;
    }
    plan = [args.only];
  }

  if (plan.length === 0) {
    log.success("No pending migrations. DB is up to date.");
    return;
  }

  log.info("Pending migrations:", plan);

  for (const f of plan) {
    await applyOneFile({ log, schemaDir, filename: f, dryRun: args.dryRun });
  }

  log.success("Schema apply complete.", { applied: plan.length, dryRun: args.dryRun });
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
  .catch(async () => {
    try {
      const anyDb: any = db as any;
      if (typeof anyDb?.end === "function") await anyDb.end();
    } catch {
      // ignore
    }
    process.exit(1);
  });
