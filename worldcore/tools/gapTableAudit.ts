// worldcore/tools/gapTableAudit.ts
//
// Milestone B (Gap Table Audit) - CLI tool.
//
// Usage:
//   ts-node worldcore/tools/gapTableAudit.ts --schemaFile planarwar_main.schema.sql
//   node dist/worldcore/tools/gapTableAudit.js --schemaFile planarwar_main.schema.sql
//
// What it does:
// - Parses worldcore/infra/schema/*.sql to discover "expected" tables.
// - Parses a schema dump (pg_dump --schema-only) to discover "existing" tables.
// - Reports missing and orphan tables. Optional JSON output and strict exit code.
//
// This is intentionally dependency-free.

import * as fs from "node:fs";
import * as path from "node:path";

import { extractTableRefsFromSql } from "./gapTableAuditLib";

type Args = {
  schemaFile: string;
  migrationsDir: string;
  json: boolean;
  strict: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    schemaFile: "",
    migrationsDir: path.join("worldcore", "infra", "schema"),
    json: false,
    strict: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--schemaFile" || a === "--schema") {
      out.schemaFile = String(argv[++i] ?? "");
      continue;
    }
    if (a === "--migrationsDir" || a === "--migrations") {
      out.migrationsDir = String(argv[++i] ?? out.migrationsDir);
      continue;
    }
    if (a === "--json") {
      out.json = true;
      continue;
    }
    if (a === "--strict") {
      out.strict = true;
      continue;
    }
    if (a === "--help" || a === "-h") {
      printHelpAndExit(0);
    }
  }

  if (!out.schemaFile) {
    printHelpAndExit(2, "Missing required --schemaFile <path>");
  }

  return out;
}

function printHelpAndExit(code: number, err?: string): never {
  if (err) console.error(`[gapTableAudit] ERROR: ${err}\n`);
  console.log(
    [
      "Gap Table Audit (Milestone B)",
      "",
      "Usage:",
      "  node dist/worldcore/tools/gapTableAudit.js --schemaFile planarwar_main.schema.sql",
      "",
      "Options:",
      "  --schemaFile <path>      Path to schema dump (pg_dump --schema-only output). [required]",
      "  --migrationsDir <path>   Directory of migration SQL files. Default: worldcore/infra/schema",
      "  --json                   Output machine-readable JSON",
      "  --strict                 Exit code 1 if any missing tables are found",
      "",
    ].join("\n"),
  );
  process.exit(code);
}

function readText(p: string): string {
  return fs.readFileSync(p, "utf8");
}

function listSqlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (e.isDirectory()) continue;
    if (!e.name.toLowerCase().endsWith(".sql")) continue;
    out.push(path.join(dir, e.name));
  }
  out.sort();
  return out;
}

function buildExpectedTableIndex(migrationsDir: string): Map<string, { firstSeenFile: string; firstSeenLine?: number }> {
  const idx = new Map<string, { firstSeenFile: string; firstSeenLine?: number }>();
  const files = listSqlFiles(migrationsDir);

  for (const f of files) {
    const sql = readText(f);
    const refs = extractTableRefsFromSql(sql);

    for (const r of refs) {
      if (!r.name) continue;
      if (idx.has(r.name)) continue;
      idx.set(r.name, { firstSeenFile: f, firstSeenLine: r.line });
    }
  }
  return idx;
}

function buildExistingTables(schemaFile: string): Map<string, { raw: string; line?: number }> {
  const sql = readText(schemaFile);
  const refs = extractTableRefsFromSql(sql);
  const m = new Map<string, { raw: string; line?: number }>();
  for (const r of refs) m.set(r.name, { raw: r.raw, line: r.line });
  return m;
}

function main(): void {
  const args = parseArgs(process.argv);

  const expectedIdx = buildExpectedTableIndex(args.migrationsDir);
  const existing = buildExistingTables(args.schemaFile);

  const expectedTables = [...expectedIdx.keys()].sort();
  const existingTables = [...existing.keys()].sort();

  const missing = expectedTables.filter((t) => !existing.has(t));
  const orphan = existingTables.filter((t) => !expectedIdx.has(t));

  const report = {
    schemaFile: args.schemaFile,
    migrationsDir: args.migrationsDir,
    expectedCount: expectedTables.length,
    existingCount: existingTables.length,
    missingCount: missing.length,
    orphanCount: orphan.length,
    missing: missing.map((t) => ({
      table: t,
      firstSeenFile: expectedIdx.get(t)?.firstSeenFile ?? "",
      firstSeenLine: expectedIdx.get(t)?.firstSeenLine,
    })),
    orphan: orphan.map((t) => ({
      table: t,
      raw: existing.get(t)?.raw ?? "",
      line: existing.get(t)?.line,
    })),
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      [
        `[gapTableAudit] schemaFile=${args.schemaFile}`,
        `[gapTableAudit] migrationsDir=${args.migrationsDir}`,
        `[gapTableAudit] expectedTables=${report.expectedCount} existingTables=${report.existingCount}`,
        "",
        `MISSING (${report.missingCount})`,
        ...report.missing.map((m) => `- ${m.table}   (first seen: ${m.firstSeenFile}${m.firstSeenLine ? ":" + m.firstSeenLine : ""})`),
        "",
        `ORPHAN (${report.orphanCount})`,
        ...report.orphan.map((o) => `- ${o.table}`),
        "",
      ].join("\n"),
    );
  }

  if (args.strict && missing.length > 0) process.exit(1);
}

main();
