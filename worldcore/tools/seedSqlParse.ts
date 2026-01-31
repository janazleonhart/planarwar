// worldcore/tools/seedSqlParse.ts
//
// Small, dependency-free helpers for parsing seed SQL files in worldcore/infra/schema.
// These parsers are intentionally conservative: they only inspect INSERT statements
// targeting specific tables and only support the patterns used in this repo's seeds.
//
// Why this exists:
// - Contract tests want to validate seed integrity (no dangling item_id references).
// - We don't want a full SQL parser dependency.
// - We do want robust quoting handling for simple VALUES tuples.

import fs from "node:fs";
import path from "node:path";

export type SeedSqlSource = {
  file: string;
  path: string;
};

export type ResolveSchemaDirResult =
  | { ok: true; schemaDir: string }
  | { ok: false; tried: string[] };

function isDir(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function* walkUpDirs(start: string, maxHops: number): Iterable<string> {
  let cur = path.resolve(start);
  for (let i = 0; i <= maxHops; i += 1) {
    yield cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
}

export function resolveSchemaDir(userProvided?: string): ResolveSchemaDirResult {
  const tried: string[] = [];
  const candidates: string[] = [];

  if (userProvided) {
    candidates.push(path.isAbsolute(userProvided) ? userProvided : path.resolve(process.cwd(), userProvided));
  }

  // Common working dirs:
  // - repo root:          <repo>/
  // - workspace root:     <repo>/worldcore/
  // - dist tool dir:      <repo>/dist/worldcore/tools/
  candidates.push(path.resolve(process.cwd(), "infra/schema")); // cwd == <repo>/worldcore -> OK
  candidates.push(path.resolve(process.cwd(), "worldcore/infra/schema")); // cwd == <repo> -> OK
  candidates.push(path.resolve(process.cwd(), "../worldcore/infra/schema")); // cwd == <repo>/worldcore -> OK

  for (const anc of walkUpDirs(process.cwd(), 6)) {
    candidates.push(path.join(anc, "worldcore/infra/schema"));
    candidates.push(path.join(anc, "infra/schema"));
  }
  for (const anc of walkUpDirs(__dirname, 8)) {
    candidates.push(path.join(anc, "worldcore/infra/schema"));
    candidates.push(path.join(anc, "infra/schema"));
  }

  // Dedup preserve order
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const c of candidates) {
    const key = path.normalize(c);
    if (!seen.has(key)) {
      seen.add(key);
      uniq.push(c);
    }
  }

  for (const c of uniq) {
    tried.push(c);
    if (isDir(c)) return { ok: true, schemaDir: c };
  }
  return { ok: false, tried };
}

export function listSqlFiles(schemaDir: string): string[] {
  const names = fs.readdirSync(schemaDir);
  return names
    .filter((n) => n.toLowerCase().endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b))
    .map((n) => path.join(schemaDir, n));
}

export function unquoteSqlString(v: string): string | null {
  const s = v.trim();
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return null;
}

export function splitTopLevelCommaList(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inStr = false;
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    if (ch === "'") {
      if (inStr && s[i + 1] === "'") {
        cur += "''";
        i += 2;
        continue;
      }
      inStr = !inStr;
      cur += ch;
      i += 1;
      continue;
    }

    if (ch === "," && !inStr) {
      out.push(cur.trim());
      cur = "";
      i += 1;
      continue;
    }

    cur += ch;
    i += 1;
  }

  if (cur.trim()) out.push(cur.trim());
  return out;
}

function normalizeIdent(x: string): string {
  const s = x.trim();
  // strip quotes
  return s.replace(/^"+|"+$/g, "").toLowerCase();
}

export function extractInsertStatementsForTable(sql: string, tableName: string): string[] {
  const t = tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Capture INSERT statements that target tableName (optionally schema-qualified / quoted).
  // Non-greedy up to ';' (seed files in this repo are simple and do not contain semicolons in strings).
  const re = new RegExp(
    `insert\\s+into\\s+(?:(?:"?[a-zA-Z_][\\w]*"?\\.)*)"?${t}"?\\b[\\s\\S]*?;`,
    "gi",
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) out.push(m[0]);
  return out;
}

export function parseInsertColumnList(statement: string): string[] {
  // "INSERT INTO table (a, b, c) VALUES ..."
  // Find first '(' after "into <table>" and the matching ')'
  const intoIdx = statement.toLowerCase().indexOf("into");
  if (intoIdx === -1) return [];
  const valuesIdx = statement.toLowerCase().indexOf("values");
  const onConflictIdx = statement.toLowerCase().indexOf("on conflict");

  const searchEnd = valuesIdx !== -1 ? valuesIdx : onConflictIdx !== -1 ? onConflictIdx : statement.length;

  const openIdx = statement.indexOf("(", intoIdx);
  if (openIdx === -1 || openIdx > searchEnd) return [];

  // Find matching close for that '(' at top-level (quotes ignored; statement is simple)
  let depth = 0;
  let inStr = false;
  for (let i = openIdx; i < statement.length; i += 1) {
    const ch = statement[i];
    if (ch === "'") {
      if (inStr && statement[i + 1] === "'") {
        i += 1;
        continue;
      }
      inStr = !inStr;
    }
    if (inStr) continue;

    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        const inner = statement.slice(openIdx + 1, i);
        return inner.split(",").map((x) => normalizeIdent(x));
      }
    }
  }
  return [];
}

export function parseValuesTuples(valuesRegion: string): string[] {
  // valuesRegion like: "(...), (...), (...)" (no leading "VALUES")
  const tuples: string[] = [];
  let inStr = false;
  let depth = 0;
  let start = -1;

  for (let i = 0; i < valuesRegion.length; i += 1) {
    const ch = valuesRegion[i];

    if (ch === "'") {
      if (inStr && valuesRegion[i + 1] === "'") {
        i += 1;
        continue;
      }
      inStr = !inStr;
      continue;
    }

    if (inStr) continue;

    if (ch === "(") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        tuples.push(valuesRegion.slice(start + 1, i)); // inner only
        start = -1;
      }
    }
  }

  return tuples;
}

export function parseInsertValuesRegion(statement: string): string | null {
  const lower = statement.toLowerCase();
  const valuesIdx = lower.indexOf("values");
  if (valuesIdx === -1) return null;

  // Cut at ON CONFLICT if present, else at ';'
  let end = lower.indexOf("on conflict", valuesIdx);
  if (end === -1) end = lower.lastIndexOf(";");
  if (end === -1) end = statement.length;

  return statement.slice(valuesIdx + "values".length, end).trim();
}

export function extractFromValuesBlocks(statement: string): Array<{ valuesRegion: string; aliasColumns: string[] }> {
  // Pattern in this repo:
  // FROM (VALUES ... ) AS v(col1, col2, ...)
  const re = /from\s*\(\s*values\s*([\s\S]*?)\)\s*as\s+v\s*\(([^)]*)\)/gi;
  const out: Array<{ valuesRegion: string; aliasColumns: string[] }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(statement))) {
    const valuesRegion = (m[1] ?? "").trim();
    const cols = (m[2] ?? "").split(",").map((x) => normalizeIdent(x));
    out.push({ valuesRegion, aliasColumns: cols });
  }
  return out;
}

export function readSqlFile(p: string): { sql: string; source: SeedSqlSource } {
  return {
    sql: fs.readFileSync(p, "utf8"),
    source: { file: path.basename(p), path: p },
  };
}
