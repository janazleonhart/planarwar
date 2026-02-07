// worldcore/tools/schemaFilenameAudit.ts

/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";

export type SchemaPrefixCollision = {
  prefix: string;
  files: string[]; // basenames
};

export type SchemaFilenameAuditResult = {
  schemaDir: string;
  sqlFiles: string[]; // basenames, deterministic
  collisions: SchemaPrefixCollision[];
};

type AuditOpts = {
  schemaDir?: string;
  json?: boolean;
  strict?: boolean;
};

function resolveSchemaDir(explicit?: string): string {
  const candidates = [
    explicit ? path.resolve(explicit) : null,
    path.resolve(process.cwd(), "infra", "schema"),
    path.resolve(process.cwd(), "worldcore", "infra", "schema"),
    path.resolve(process.cwd(), "..", "infra", "schema"),
    path.resolve(__dirname, "..", "..", "..", "worldcore", "infra", "schema"),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
    } catch {
      // ignore
    }
  }
  return candidates[0] ?? path.resolve(process.cwd(), "worldcore", "infra", "schema");
}

function listSqlFiles(schemaDir: string): string[] {
  const entries = fs.readdirSync(schemaDir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.toLowerCase().endsWith(".sql")) continue;
    files.push(e.name);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

export function extractNumericPrefix(basename: string): string | null {
  const m = /^(\d+)[_-]/.exec(basename);
  return m ? m[1] : null;
}

export function findDuplicateSchemaPrefixes(files: string[]): SchemaPrefixCollision[] {
  const byPrefix = new Map<string, string[]>();
  for (const f of files) {
    const pfx = extractNumericPrefix(f);
    if (!pfx) continue;
    const arr = byPrefix.get(pfx) ?? [];
    arr.push(f);
    byPrefix.set(pfx, arr);
  }

  const collisions: SchemaPrefixCollision[] = [];
  for (const [prefix, names] of byPrefix.entries()) {
    if (names.length > 1) collisions.push({ prefix, files: names.slice().sort((a, b) => a.localeCompare(b)) });
  }

  collisions.sort((a, b) => {
    const na = parseInt(a.prefix, 10);
    const nb = parseInt(b.prefix, 10);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
    return a.prefix.localeCompare(b.prefix);
  });

  return collisions;
}

export function auditSchemaFilenames(opts: AuditOpts = {}): SchemaFilenameAuditResult {
  const schemaDir = resolveSchemaDir(opts.schemaDir);
  const sqlFiles = listSqlFiles(schemaDir);
  const collisions = findDuplicateSchemaPrefixes(sqlFiles);
  return { schemaDir, sqlFiles, collisions };
}

function parseArgs(argv: string[]): AuditOpts {
  const opts: AuditOpts = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--strict") opts.strict = true;
    else if (a === "--schemaDir" || a === "--schema-dir") {
      const v = argv[i + 1];
      if (v) {
        opts.schemaDir = v;
        i += 1;
      }
    }
  }
  return opts;
}

function formatHuman(res: SchemaFilenameAuditResult): string {
  const lines: string[] = [];
  lines.push(`[schemaFilenameAudit] schemaDir=${res.schemaDir}`);
  lines.push(`[schemaFilenameAudit] sqlFiles=${res.sqlFiles.length}`);
  if (res.collisions.length === 0) {
    lines.push(`[schemaFilenameAudit] OK: no duplicate numeric prefixes`);
    return lines.join("\n");
  }

  lines.push(`[schemaFilenameAudit] WARN: duplicate numeric prefixes detected: ${res.collisions.length}`);
  for (const c of res.collisions) {
    lines.push(`  - ${c.prefix}: ${c.files.join(", ")}`);
  }
  lines.push(`[schemaFilenameAudit] Note: duplicate prefixes are supported (lexicographic order), but may confuse humans.`);
  lines.push(`[schemaFilenameAudit] Set --strict or PW_SCHEMA_DUPLICATE_PREFIX_STRICT=1 to fail on duplicates.`);
  return lines.join("\n");
}

if (require.main === module) {
  const cli = parseArgs(process.argv);
  const envStrict = process.env.PW_SCHEMA_DUPLICATE_PREFIX_STRICT === "1";
  const strict = Boolean(cli.strict || envStrict);

  const res = auditSchemaFilenames(cli);

  if (cli.json) console.log(JSON.stringify(res, null, 2));
  else console.log(formatHuman(res));

  if (strict && res.collisions.length > 0) {
    process.exitCode = 2;
  }
}
