// worldcore/tools/seedSpellIdAudit.ts
//
// Audit: ensure any spell_id referenced by seed spell_unlocks exists in the seeded spells catalog.
// This prevents FK violations like: spell_unlocks.spell_id -> spells.id
//
// Usage (repo root):
//   node dist/worldcore/tools/seedSpellIdAudit.js
//   node dist/worldcore/tools/seedSpellIdAudit.js --schemaDir worldcore/infra/schema
//   node dist/worldcore/tools/seedSpellIdAudit.js --json
//   node dist/worldcore/tools/seedSpellIdAudit.js --allowMissing foo,bar
//
// Exit code: 0 if OK; 1 if missing spell ids (unless allowed).

/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";

export type SeedSpellIdAuditResult = {
  schemaDir: string;
  seededSpellIds: Set<string>;
  unlockSpellIds: Set<string>;
  missingSpellIds: string[];
  filesScanned: string[];
};

type AuditOpts = {
  schemaDir?: string;
  json?: boolean;
  allowMissing?: string[];
};

/**
 * Resolve the schema directory robustly across these execution contexts:
 * - repo root:      <repo>/worldcore/infra/schema
 * - workspace cwd:  <repo>/worldcore  (npm test -w worldcore)
 * - dist tests:     cwd still <repo>/worldcore in your runner
 */
function resolveSchemaDir(explicit?: string): string {
  const candidates = [
    explicit ? path.resolve(explicit) : null,
    // When cwd is <repo>/worldcore
    path.resolve(process.cwd(), "infra", "schema"),
    // When cwd is repo root
    path.resolve(process.cwd(), "worldcore", "infra", "schema"),
    // When cwd is <repo>/worldcore/dist (unlikely, but cheap)
    path.resolve(process.cwd(), "..", "infra", "schema"),
    // When running from dist/worldcore/tools
    path.resolve(__dirname, "..", "..", "..", "worldcore", "infra", "schema"),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
    } catch {
      // ignore
    }
  }

  // Fall back to the most likely path for a helpful error.
  return candidates[0] ?? path.resolve(process.cwd(), "worldcore", "infra", "schema");
}

function getFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...getFilesRecursive(p));
    else if (entry.isFile() && p.endsWith(".sql")) out.push(p);
  }
  return out.sort();
}

function stripSqlComments(sql: string): string {
  // Remove -- line comments and /* */ blocks.
  const noLine = sql.replace(/--.*$/gm, "");
  return noLine.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Extract value tuples from a simple INSERT statement.
 * We don't implement a full SQL parser; we implement the patterns you use
 * in schema seeds (VALUES (...), (...), ...;).
 */
function extractInsertStatements(sql: string, tableName: string): Array<{ columns: string[] | null; valuesChunk: string }> {
  const cleaned = stripSqlComments(sql);
  const stmts: Array<{ columns: string[] | null; valuesChunk: string }> = [];

  // Handles:
  // INSERT INTO table (a,b,c) VALUES (...), (...);
  // INSERT INTO table VALUES (...), (...);
  const reStmt = new RegExp(
    String.raw`INSERT\s+INTO\s+${tableName}\s*(\(([^)]*)\))?\s*VALUES\s*([\s\S]*?);`,
    "gi"
  );

  let m: RegExpExecArray | null;
  while ((m = reStmt.exec(cleaned))) {
    const colsRaw = m[2];
    const valuesChunk = m[3];
    const columns = colsRaw
      ? colsRaw
          .split(",")
          .map((s) => s.trim().replace(/["']/g, ""))
          .filter(Boolean)
      : null;
    stmts.push({ columns, valuesChunk });
  }
  return stmts;
}

function splitTopLevelTuples(valuesChunk: string): string[] {
  // Split "(...),(...),(...)" into ["(...)", "(...)", "(...)"] respecting nested parentheses and quotes.
  const tuples: string[] = [];
  let i = 0;
  let depth = 0;
  let inStr = false;
  let strCh = "";
  let start = -1;

  while (i < valuesChunk.length) {
    const ch = valuesChunk[i];

    if (inStr) {
      if (ch === strCh) {
        // handle escaped quote '' inside strings
        const next = valuesChunk[i + 1];
        if (next === strCh) {
          i += 2;
          continue;
        }
        inStr = false;
        strCh = "";
      }
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"') {
      inStr = true;
      strCh = ch;
      i += 1;
      continue;
    }

    if (ch === "(") {
      depth += 1;
      if (depth === 1) start = i;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        tuples.push(valuesChunk.slice(start, i + 1));
        start = -1;
      }
    }

    i += 1;
  }

  return tuples;
}

function splitTupleValues(tuple: string): string[] {
  // tuple includes parentheses
  const inner = tuple.trim().replace(/^\(/, "").replace(/\)$/, "");
  const vals: string[] = [];
  let i = 0;
  let inStr = false;
  let strCh = "";
  let depth = 0;
  let cur = "";

  while (i < inner.length) {
    const ch = inner[i];

    if (inStr) {
      cur += ch;
      if (ch === strCh) {
        const next = inner[i + 1];
        if (next === strCh) {
          // escaped quote
          cur += next;
          i += 2;
          continue;
        }
        inStr = false;
        strCh = "";
      }
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"') {
      inStr = true;
      strCh = ch;
      cur += ch;
      i += 1;
      continue;
    }

    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;

    if (ch === "," && depth === 0) {
      vals.push(cur.trim());
      cur = "";
      i += 1;
      continue;
    }

    cur += ch;
    i += 1;
  }

  if (cur.trim().length) vals.push(cur.trim());
  return vals;
}

function unquoteSqlString(v: string): string | null {
  const s = v.trim();
  if (s.toUpperCase() === "NULL") return null;
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    // unescape doubled quotes for the wrapping quote type
    const q = s[0];
    const body = s.slice(1, -1);
    const unescaped = q === "'" ? body.replace(/''/g, "'") : body.replace(/""/g, '"');
    return unescaped;
  }
  // Non-string literal (numbers, functions) -> not an id
  return null;
}

function collectSeededSpellIdsFromSql(sql: string): Set<string> {
  const out = new Set<string>();
  const inserts = extractInsertStatements(sql, "spells");
  for (const ins of inserts) {
    // need the id column
    let idIdx = 0; // default for INSERT INTO spells VALUES (id, ...)
    if (ins.columns) {
      const idx = ins.columns.findIndex((c) => c === "id");
      if (idx < 0) continue;
      idIdx = idx;
    }
    const tuples = splitTopLevelTuples(ins.valuesChunk);
    for (const t of tuples) {
      const vals = splitTupleValues(t);
      const idVal = vals[idIdx];
      const id = idVal ? unquoteSqlString(idVal) : null;
      if (id) out.add(id);
    }
  }
  return out;
}

function collectUnlockSpellIdsFromSql(sql: string): Set<string> {
  const out = new Set<string>();
  const inserts = extractInsertStatements(sql, "spell_unlocks");
  for (const ins of inserts) {
    // Find spell_id column if present, otherwise assume 2nd position (class_id, spell_id, ...)
    let spellIdx = 1;
    if (ins.columns) {
      const idx = ins.columns.findIndex((c) => c === "spell_id");
      if (idx < 0) continue;
      spellIdx = idx;
    }
    const tuples = splitTopLevelTuples(ins.valuesChunk);
    for (const t of tuples) {
      const vals = splitTupleValues(t);
      const v = vals[spellIdx];
      const spellId = v ? unquoteSqlString(v) : null;
      if (spellId) out.add(spellId);
    }
  }
  return out;
}

export function runSeedSpellIdAudit(opts: AuditOpts = {}): SeedSpellIdAuditResult {
  const schemaDir = resolveSchemaDir(opts.schemaDir);

  const files = getFilesRecursive(schemaDir);
  const seededSpellIds = new Set<string>();
  const unlockSpellIds = new Set<string>();

  for (const f of files) {
    const sql = fs.readFileSync(f, "utf8");
    for (const id of collectSeededSpellIdsFromSql(sql)) seededSpellIds.add(id);
    for (const id of collectUnlockSpellIdsFromSql(sql)) unlockSpellIds.add(id);
  }

  const allow = new Set((opts.allowMissing ?? []).filter(Boolean));
  const missing = [...unlockSpellIds].filter((id) => !seededSpellIds.has(id) && !allow.has(id)).sort();

  return {
    schemaDir,
    seededSpellIds,
    unlockSpellIds,
    missingSpellIds: missing,
    filesScanned: files.map((p) => path.relative(process.cwd(), p)),
  };
}

function parseArgs(argv: string[]): AuditOpts {
  const opts: AuditOpts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--schemaDir") opts.schemaDir = argv[++i];
    else if (a === "--json") opts.json = true;
    else if (a === "--allowMissing") opts.allowMissing = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  return opts;
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  const res = runSeedSpellIdAudit(opts);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          schemaDir: res.schemaDir,
          missingSpellIds: res.missingSpellIds,
          counts: {
            filesScanned: res.filesScanned.length,
            seededSpellIds: res.seededSpellIds.size,
            unlockSpellIds: res.unlockSpellIds.size,
            missingSpellIds: res.missingSpellIds.length,
          },
        },
        null,
        2
      )
    );
  } else if (res.missingSpellIds.length) {
    console.error(`[seedSpellIdAudit] FAIL: ${res.missingSpellIds.length} unlock spell_id(s) missing from seeded spells`);
    for (const id of res.missingSpellIds) console.error(`- ${id}`);
  } else {
    console.log(
      `[seedSpellIdAudit] OK: unlockSpellIds=${res.unlockSpellIds.size} seededSpellIds=${res.seededSpellIds.size} files=${res.filesScanned.length}`
    );
  }

  process.exit(res.missingSpellIds.length ? 1 : 0);
}
