// worldcore/tools/seedNpcLawTagsAudit.ts
//
// Seed integrity audit: NPC law-tag invariants.
//
// This audit inspects *seed SQL* under worldcore/infra/schema (NOT runtime DB state).
// It is designed to run in CI (via contract test) and as an optional CLI tool.
//
// Key goals:
//  1) Enforce final (last-seen) tag invariants for specific NPC ids.
//  2) Provide provenance: which schema file most recently seeded each NPC id,
//     so failures point at the exact migration.
//  3) Avoid false positives by only parsing INSERT statements that target `npcs`.
//
// Repo layout quirk:
// - Tests often run with process.cwd() == <repo>/worldcore (workspace root).
// - Dist JS runs with __dirname == <repo>/dist/worldcore/tools.
// So we resolve schemaDir by searching multiple likely paths AND walking upward.

import fs from "node:fs";
import path from "node:path";

export type SeedNpcLawTagsAuditIssue =
  | { kind: "schema_dir_missing"; schemaDirTried: string[] }
  | { kind: "missing_seed_row"; npcId: string }
  | { kind: "missing_tag"; npcId: string; tag: string; tags: string[]; source?: SeedNpcSeedSource }
  | { kind: "forbidden_tag"; npcId: string; tag: string; tags: string[]; source?: SeedNpcSeedSource };

export type SeedNpcSeedSource = {
  file: string;      // basename (e.g., 052_seed_....sql)
  path: string;      // full path on disk
  ordinal: number;   // monotonically increasing in scan order (for debugging)
};

export type SeedNpcLawTagsAuditResult = {
  schemaDir: string;
  filesScanned: number;
  tagsByNpcId: Record<string, string[]>;
  /** Last-seen provenance for each npc id we observed. */
  lastSourceByNpcId: Record<string, SeedNpcSeedSource>;
  /** Optional: all sources seen for each npc id (only populated when requested). */
  allSourcesByNpcId?: Record<string, SeedNpcSeedSource[]>;
  issues: SeedNpcLawTagsAuditIssue[];
};

export type AuditOpts = {
  schemaDir?: string;
  /** When true, include allSourcesByNpcId in the result (slightly heavier). */
  includeAllSources?: boolean;
  /**
   * When true, validate required tags against *every* occurrence across schema files,
   * not just the final (last-seen) tags. This is useful to detect "tag drift" migrations
   * that temporarily overwrite rows with unsafe tags.
   *
   * Default false to keep the audit low-noise; contract tests typically use final-only.
   */
  strictAllOccurrences?: boolean;
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

  // Deduplicate while preserving order.
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
      // SQL escape: '' inside string
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

  // ARRAY['a','b',...]
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

  // '{a,b}' or '{"a","b"}' (may be quoted)
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

type ParsedNpcTuple = { npcId: string; tags: string[] };

function collectNpcIdAndTagsFromSql(sql: string): ParsedNpcTuple[] {
  const out: ParsedNpcTuple[] = [];

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
      out.push({ npcId: id, tags });
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
      lastSourceByNpcId: {},
      issues: [{ kind: "schema_dir_missing", schemaDirTried: resolved.tried }],
    };
  }

  const schemaDir = resolved.schemaDir;
  const files = listSqlFiles(schemaDir);

  // Last-seen wins (sorted by filename): later migrations override earlier ones.
  const tagsByNpcId = new Map<string, string[]>();
  const lastSourceByNpcId = new Map<string, SeedNpcSeedSource>();
  const allSourcesByNpcId = new Map<string, SeedNpcSeedSource[]>();

  let ordinal = 0;

  for (const f of files) {
    const sql = fs.readFileSync(f, "utf8");
    const tuples = collectNpcIdAndTagsFromSql(sql);
    if (!tuples.length) continue;

    const base = path.basename(f);

    for (const t of tuples) {
      ordinal += 1;
      const src: SeedNpcSeedSource = { file: base, path: f, ordinal };

      tagsByNpcId.set(t.npcId, t.tags);
      lastSourceByNpcId.set(t.npcId, src);

      const arr = allSourcesByNpcId.get(t.npcId) ?? [];
      arr.push(src);
      allSourcesByNpcId.set(t.npcId, arr);
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

  function issueSource(npcId: string): SeedNpcSeedSource | undefined {
    return lastSourceByNpcId.get(npcId);
  }

  // Final (last-seen) validation.
  for (const npcId of Object.keys(REQUIRE) as Array<keyof typeof REQUIRE>) {
    const tags = tagsByNpcId.get(npcId);
    if (!tags) {
      issues.push({ kind: "missing_seed_row", npcId });
      continue;
    }

    for (const req of REQUIRE[npcId]) {
      if (!tags.includes(req)) {
        issues.push({ kind: "missing_tag", npcId, tag: req, tags, source: issueSource(npcId) });
      }
    }

    const forbid = FORBID[npcId as keyof typeof FORBID];
    if (forbid) {
      for (const bad of forbid) {
        if (tags.includes(bad)) {
          issues.push({ kind: "forbidden_tag", npcId, tag: bad, tags, source: issueSource(npcId) });
        }
      }
    }
  }

  // Optional drift detection: validate *every* occurrence (by scanning file order).
  if (opts.strictAllOccurrences) {
    // We need tags per occurrence; recompute cheaply by rescanning, but only for required ids.
    const requiredIds = new Set<string>(Object.keys(REQUIRE));

    for (const f of files) {
      const sql = fs.readFileSync(f, "utf8");
      const tuples = collectNpcIdAndTagsFromSql(sql);
      if (!tuples.length) continue;

      for (const t of tuples) {
        if (!requiredIds.has(t.npcId)) continue;

        const src = lastSourceByNpcId.get(t.npcId);
        // For strict mode, we want the current file as source, not the last one.
        const strictSource: SeedNpcSeedSource = { file: path.basename(f), path: f, ordinal: -1 };

        const req = REQUIRE[t.npcId as keyof typeof REQUIRE];
        for (const tag of req) {
          if (!t.tags.includes(tag)) {
            issues.push({ kind: "missing_tag", npcId: t.npcId, tag, tags: t.tags, source: strictSource });
          }
        }

        const forbid = FORBID[t.npcId as keyof typeof FORBID];
        if (forbid) {
          for (const bad of forbid) {
            if (t.tags.includes(bad)) {
              issues.push({ kind: "forbidden_tag", npcId: t.npcId, tag: bad, tags: t.tags, source: strictSource });
            }
          }
        }
      }
    }
  }

  const tagsObj: Record<string, string[]> = {};
  for (const [k, v] of tagsByNpcId.entries()) tagsObj[k] = v;

  const lastObj: Record<string, SeedNpcSeedSource> = {};
  for (const [k, v] of lastSourceByNpcId.entries()) lastObj[k] = v;

  const res: SeedNpcLawTagsAuditResult = {
    schemaDir,
    filesScanned: files.length,
    tagsByNpcId: tagsObj,
    lastSourceByNpcId: lastObj,
    issues,
  };

  if (opts.includeAllSources) {
    const allObj: Record<string, SeedNpcSeedSource[]> = {};
    for (const [k, v] of allSourcesByNpcId.entries()) allObj[k] = v;
    res.allSourcesByNpcId = allObj;
  }

  return res;
}

// CLI: node dist/worldcore/tools/seedNpcLawTagsAudit.js [--schemaDir <path>] [--json] [--allSources] [--strictAllOccurrences]
if (require.main === module) {
  const argv = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    if (i === -1) return undefined;
    return argv[i + 1];
  };

  const schemaDir = getArg("--schemaDir");
  const asJson = argv.includes("--json");
  const allSources = argv.includes("--allSources");
  const strictAllOccurrences = argv.includes("--strictAllOccurrences");

  const res = runSeedNpcLawTagsAudit({ schemaDir, includeAllSources: allSources, strictAllOccurrences });

  if (asJson) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.issues.length ? 1 : 0);
  }

  if (res.issues.length) {
    // eslint-disable-next-line no-console
    console.error(`[seedNpcLawTagsAudit] FAIL: ${res.issues.length} issue(s)`);
    for (const i of res.issues) {
      if (i.kind === "schema_dir_missing") {
        // eslint-disable-next-line no-console
        console.error(`- schema dir missing (tried: ${i.schemaDirTried.join(", ")})`);
        continue;
      }
      if (i.kind === "missing_seed_row") {
        // eslint-disable-next-line no-console
        console.error(`- missing seed row for '${i.npcId}'`);
        continue;
      }

      const src = (i as any).source as SeedNpcSeedSource | undefined;
      const where = src ? ` @ ${src.file}` : "";
      if (i.kind === "missing_tag") {
        // eslint-disable-next-line no-console
        console.error(`- ${i.npcId} missing tag '${i.tag}' (tags: ${(i.tags ?? []).join(",")})${where}`);
      } else if (i.kind === "forbidden_tag") {
        // eslint-disable-next-line no-console
        console.error(`- ${i.npcId} has forbidden tag '${i.tag}' (tags: ${(i.tags ?? []).join(",")})${where}`);
      }
    }
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`[seedNpcLawTagsAudit] OK: filesScanned=${res.filesScanned} schemaDir=${res.schemaDir}`);
}
