// worldcore/tools/seedAbilityIdAudit.ts

/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";

export type SeedAbilityIdAuditResult = {
  schemaDir: string;
  missingAbilityIds: string[];
  counts: {
    filesScanned: number;
    unlockAbilityIds: number;
    seededAbilityIds: number;
    missingAbilityIds: number;
  };
};

type AuditOpts = {
  schemaDir?: string;
  json?: boolean;
  allowMissing?: string[];
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

function fileSortKey(p: string): { n: number; letter: string; weight: number; name: string } {
  const name = path.basename(p);
  const m = /^(\d+)([A-Za-z]?)[_\-]/.exec(name);
  const n = m ? parseInt(m[1], 10) : 0;
  const letter = m ? m[2] : "";
  const lower = name.toLowerCase();

  // Ensure bootstrap-from-unlocks seed occurs AFTER ability_unlocks within same numeric prefix.
  let weight = 1.5;
  if (lower.includes("create_abilities_table") || lower.includes("create_ability_unlocks_table")) weight = 0.0;
  else if (lower.includes("seed_ability_unlocks")) weight = 1.0;
  else if (lower.includes("seed_abilities_from_unlocks")) weight = 2.0;

  return { n, letter, weight, name };
}

function getFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...getFilesRecursive(p));
    else if (entry.isFile() && p.endsWith(".sql")) out.push(p);
  }

  return out.sort((a, b) => {
    const ka = fileSortKey(a);
    const kb = fileSortKey(b);
    if (ka.n !== kb.n) return ka.n - kb.n;
    if (ka.letter !== kb.letter) return ka.letter.localeCompare(kb.letter);
    if (ka.weight !== kb.weight) return ka.weight - kb.weight;
    return ka.name.localeCompare(kb.name);
  });
}

function stripSqlComments(sql: string): string {
  const noLine = sql.replace(/--.*$/gm, "");
  return noLine.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractInsertStatements(sql: string, tableName: string): Array<{ columns: string[] | null; valuesChunk: string }> {
  const cleaned = stripSqlComments(sql);
  const stmts: Array<{ columns: string[] | null; valuesChunk: string }> = [];

  const reStmt = new RegExp(
    String.raw`INSERT\s+INTO\s+(?:public\.)?${tableName}\s*(\(([^)]*)\))?\s*VALUES\s*([\s\S]*?);`,
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
    const q = s[0];
    const body = s.slice(1, -1);
    const unescaped = q === "'" ? body.replace(/''/g, "'") : body.replace(/""/g, '"');
    return unescaped;
  }
  return null;
}

function collectUnlockAbilityIds(sql: string): Set<string> {
  const out = new Set<string>();
  const inserts = extractInsertStatements(sql, "ability_unlocks");
  for (const ins of inserts) {
    let abilityIdx = 1;
    if (ins.columns) {
      const idx = ins.columns.findIndex((c) => c === "ability_id");
      if (idx < 0) continue;
      abilityIdx = idx;
    }
    for (const t of splitTopLevelTuples(ins.valuesChunk)) {
      const vals = splitTupleValues(t);
      const id = vals[abilityIdx] ? unquoteSqlString(vals[abilityIdx]) : null;
      if (id) out.add(id);
    }
  }
  return out;
}

function collectExplicitAbilityCatalogIds(sql: string): Set<string> {
  const out = new Set<string>();
  const inserts = extractInsertStatements(sql, "abilities");
  for (const ins of inserts) {
    let idIdx = 0;
    if (ins.columns) {
      const idx = ins.columns.findIndex((c) => c === "id");
      if (idx < 0) continue;
      idIdx = idx;
    }
    for (const t of splitTopLevelTuples(ins.valuesChunk)) {
      const vals = splitTupleValues(t);
      const id = vals[idIdx] ? unquoteSqlString(vals[idIdx]) : null;
      if (id) out.add(id);
    }
  }
  return out;
}

function detectsBootstrapFromUnlocks(sql: string): boolean {
  const cleaned = stripSqlComments(sql).toLowerCase();
  return (
    cleaned.includes("insert into public.abilities") &&
    cleaned.includes("from public.ability_unlocks") &&
    cleaned.includes("select distinct") &&
    cleaned.includes("ability_id")
  );
}

export function runSeedAbilityIdAudit(opts: AuditOpts = {}): SeedAbilityIdAuditResult {
  const schemaDir = resolveSchemaDir(opts.schemaDir);
  const files = getFilesRecursive(schemaDir);

  const allow = new Set((opts.allowMissing ?? []).filter(Boolean));

  const seededAbilityIds = new Set<string>();
  const unlockAbilityIdsSoFar = new Set<string>();

  for (const f of files) {
    const sql = fs.readFileSync(f, "utf8");

    for (const id of collectUnlockAbilityIds(sql)) unlockAbilityIdsSoFar.add(id);
    for (const id of collectExplicitAbilityCatalogIds(sql)) seededAbilityIds.add(id);

    if (detectsBootstrapFromUnlocks(sql)) {
      for (const id of unlockAbilityIdsSoFar) seededAbilityIds.add(id);
    }
  }

  const missing = [...unlockAbilityIdsSoFar]
    .filter((id) => !seededAbilityIds.has(id) && !allow.has(id))
    .sort();

  return {
    schemaDir,
    missingAbilityIds: missing,
    counts: {
      filesScanned: files.length,
      unlockAbilityIds: unlockAbilityIdsSoFar.size,
      seededAbilityIds: seededAbilityIds.size,
      missingAbilityIds: missing.length,
    },
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
  const res = runSeedAbilityIdAudit(opts);

  if (opts.json) {
    console.log(JSON.stringify({ schemaDir: res.schemaDir, missingAbilityIds: res.missingAbilityIds, counts: res.counts }, null, 2));
  } else if (res.missingAbilityIds.length) {
    console.error(`[seedAbilityIdAudit] FAIL: ${res.missingAbilityIds.length} unlock ability_id(s) not covered by abilities seeding flow`);
    for (const id of res.missingAbilityIds) console.error(`- ${id}`);
  } else {
    console.log(
      `[seedAbilityIdAudit] OK: unlockAbilityIds=${res.counts.unlockAbilityIds} seededAbilityIds=${res.counts.seededAbilityIds} files=${res.counts.filesScanned}`
    );
  }

  process.exit(res.missingAbilityIds.length ? 1 : 0);
}
