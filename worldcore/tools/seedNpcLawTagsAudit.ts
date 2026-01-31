// worldcore/tools/seedNpcLawTagsAudit.ts
//
// Seed integrity audit: NPC law-tag invariants.
//
// This audit inspects *seed SQL* under worldcore/infra/schema (NOT runtime DB state).
// It is designed to run in CI (via contract test) and as an optional CLI tool.
//
// IMPORTANT: We only parse INSERTs that target the `npcs` table. Other tables may contain
// tuples with ARRAY[...] tags (e.g., spawn points), and we must not confuse those with NPC seeds.

import fs from "node:fs";
import path from "node:path";

export type SeedNpcLawTagsAuditIssue =
  | { kind: "schema_dir_missing"; schemaDirTried: string[] }
  | { kind: "missing_seed_row"; npcId: string }
  | { kind: "missing_tag"; npcId: string; tag: string; tags: string[] }
  | { kind: "forbidden_tag"; npcId: string; tag: string; tags: string[] };

export type SeedNpcLawTagsAuditResult = {
  schemaDir: string;
  filesScanned: number;
  tagsByNpcId: Record<string, string[]>;
  issues: SeedNpcLawTagsAuditIssue[];
};

export type AuditOpts = {
  schemaDir?: string;
};

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

function resolveSchemaDir(
  userProvided?: string,
): { ok: true; schemaDir: string } | { ok: false; tried: string[] } {
  const tried: string[] = [];
  const candidates: string[] = [];

  if (userProvided) {
    candidates.push(path.isAbsolute(userProvided) ? userProvided : path.resolve(process.cwd(), userProvided));
  }

  // Common working directories:
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

function listSqlFiles(schemaDir: string): string[] {
  const names = fs.readdirSync(schemaDir);
  return names
    .filter((n) => n.toLowerCase().endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b))
    .map((n) => path.join(schemaDir, n));
}

function unquoteSqlString(v: string): string | null {
  const s = v.trim();
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return null;
}

function splitTopLevelCommaList(s: string): string[] {
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

function parseArrayTags(arrayExpr: string): string[] {
  const s = arrayExpr.trim();

  if (/^ARRAY\s*\[/i.test(s)) {
    const inner = s.replace(/^ARRAY\s*\[/i, "").replace(/\]$/, "");
    const parts = splitTopLevelCommaList(inner);
    const tags: string[] = [];
    for (const p of parts) {
      const u = unquoteSqlString(p);
      if (u != null) tags.push(u);
    }
    return tags;
  }

  const uq = unquoteSqlString(s);
  const lit = uq ?? s;
  if (lit.startsWith("{") && lit.endsWith("}")) {
    const inner = lit.slice(1, -1);
    const parts = splitTopLevelCommaList(inner);
    const tags: string[] = [];
    for (const p of parts) {
      const u = unquoteSqlString(p);
      if (u != null) tags.push(u);
      else if (p.trim()) tags.push(p.trim().replace(/^"|"$/g, ""));
    }
    return tags;
  }

  return [];
}

function extractNpcInsertStatements(sql: string): string[] {
  // Capture INSERT statements that target npcs (optionally schema-qualified / quoted).
  // Non-greedy up to ';' (seed files in this repo are simple and do not contain semicolons in strings).
  const re =
    /insert\s+into\s+(?:(?:"?[a-zA-Z_][\w]*"?\.)*)"?npcs"?\b[\s\S]*?;/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) out.push(m[0]);
  return out;
}

function collectNpcIdAndTagsFromSql(sql: string): Map<string, string[]> {
  const out = new Map<string, string[]>();

  // Only parse inserts into npcs.
  const statements = extractNpcInsertStatements(sql);
  if (!statements.length) return out;

  // Common seed pattern:
  // INSERT INTO npcs (...) VALUES ( 'id', ..., ARRAY['t1','t2'], ... ), (...);
  const tupleRe = /\(\s*'([^']+)'[\s\S]*?\bARRAY\s*\[([^\]]*)\]/gi;

  for (const stmt of statements) {
    let m: RegExpExecArray | null;
    while ((m = tupleRe.exec(stmt))) {
      const id = m[1];
      const arrayInner = m[2];
      const tags = parseArrayTags("ARRAY[" + arrayInner + "]");
      out.set(id, tags);
    }
    tupleRe.lastIndex = 0; // reset between statements
  }

  return out;
}

export function runSeedNpcLawTagsAudit(opts: AuditOpts = {}): SeedNpcLawTagsAuditResult {
  const resolved = resolveSchemaDir(opts.schemaDir);
  if (!resolved.ok) {
    return {
      schemaDir: "",
      filesScanned: 0,
      tagsByNpcId: {},
      issues: [{ kind: "schema_dir_missing", schemaDirTried: resolved.tried }],
    };
  }

  const schemaDir = resolved.schemaDir;
  const files = listSqlFiles(schemaDir);

  const tagsByNpcId = new Map<string, string[]>();

  for (const f of files) {
    const sql = fs.readFileSync(f, "utf8");
    const m = collectNpcIdAndTagsFromSql(sql);
    for (const [id, tags] of m.entries()) {
      tagsByNpcId.set(id, tags);
    }
  }

  const issues: SeedNpcLawTagsAuditIssue[] = [];

  const REQUIRE = {
    training_dummy: ["training", "law_exempt"],
    training_dummy_big: ["training", "law_exempt"],
    town_civilian: ["civilian", "protected_town", "law_protected"],
  } as const;

  const FORBID = {
    town_civilian: ["law_exempt"],
  } as const;

  for (const npcId of Object.keys(REQUIRE) as Array<keyof typeof REQUIRE>) {
    const tags = tagsByNpcId.get(npcId);
    if (!tags) {
      issues.push({ kind: "missing_seed_row", npcId });
      continue;
    }

    for (const req of REQUIRE[npcId]) {
      if (!tags.includes(req)) {
        issues.push({ kind: "missing_tag", npcId, tag: req, tags });
      }
    }

    const forbid = FORBID[npcId as keyof typeof FORBID];
    if (forbid) {
      for (const bad of forbid) {
        if (tags.includes(bad)) issues.push({ kind: "forbidden_tag", npcId, tag: bad, tags });
      }
    }
  }

  const tagsObj: Record<string, string[]> = {};
  for (const [k, v] of tagsByNpcId.entries()) tagsObj[k] = v;

  return {
    schemaDir,
    filesScanned: files.length,
    tagsByNpcId: tagsObj,
    issues,
  };
}

if (require.main === module) {
  const res = runSeedNpcLawTagsAudit();
  if (res.issues.length) {
    // eslint-disable-next-line no-console
    console.error(
      `[seedNpcLawTagsAudit] FAIL: ${res.issues.length} issue(s)\n` +
        res.issues.map((i) => JSON.stringify(i)).join("\n"),
    );
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`[seedNpcLawTagsAudit] OK: filesScanned=${res.filesScanned} schemaDir=${res.schemaDir}`);
}
