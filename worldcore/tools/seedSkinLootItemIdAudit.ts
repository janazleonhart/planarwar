// worldcore/tools/seedSkinLootItemIdAudit.ts
//
// Seed integrity audit: skin_loot.item_id must reference an item seeded in worldcore/infra/schema.
//
// This audit inspects seed SQL files (not runtime DB state).
// It is designed for CI contract tests and optional CLI use.

import {
  extractFromValuesBlocks,
  extractInsertStatementsForTable,
  listSqlFiles,
  parseInsertColumnList,
  parseInsertValuesRegion,
  parseValuesTuples,
  readSqlFile,
  resolveSchemaDir,
  splitTopLevelCommaList,
  unquoteSqlString,
  type SeedSqlSource,
} from "./seedSqlParse";

export type SeedSkinLootItemIdAuditIssue =
  | { kind: "schema_dir_missing"; schemaDirTried: string[] }
  | { kind: "missing_seeded_item"; table: "skin_loot"; itemId: string; sources: SeedSqlSource[] };

export type SeedSkinLootItemIdAuditResult = {
  schemaDir: string;
  filesScanned: number;
  seededItemIds: string[];
  referencedItemIds: string[];
  issues: SeedSkinLootItemIdAuditIssue[];
};

export type AuditOpts = {
  schemaDir?: string;
};

function collectSeededItemIdsFromStatement(stmt: string): string[] {
  const cols = parseInsertColumnList(stmt);
  const idIdx = cols.length ? cols.indexOf("id") : 0;

  const region = parseInsertValuesRegion(stmt);
  if (!region) return [];

  const tuples = parseValuesTuples(region);
  const out: string[] = [];
  for (const t of tuples) {
    const parts = splitTopLevelCommaList(t);
    const raw = parts[idIdx] ?? parts[0];
    const v = raw ? unquoteSqlString(raw) : null;
    if (v) out.push(v);
  }
  return out;
}

function collectReferencedItemIdsFromSkinLootStatement(stmt: string): string[] {
  const out: string[] = [];

  // Two patterns exist in this repo:
  //  1) INSERT INTO skin_loot (...) SELECT ... FROM (VALUES (...)) AS v(... item_id ...)
  //  2) (potentially) INSERT INTO skin_loot (...) VALUES (...)
  //
  // Prefer FROM (VALUES ...) blocks when present.
  const blocks = extractFromValuesBlocks(stmt);
  if (blocks.length) {
    for (const b of blocks) {
      const itemIdx = b.aliasColumns.indexOf("item_id");
      if (itemIdx === -1) continue;

      const tuples = parseValuesTuples(b.valuesRegion);
      for (const t of tuples) {
        const parts = splitTopLevelCommaList(t);
        const raw = parts[itemIdx];
        const v = raw ? unquoteSqlString(raw) : null;
        if (v) out.push(v);
      }
    }
    return out;
  }

  // Fallback: direct VALUES
  const cols = parseInsertColumnList(stmt);
  const itemIdx = cols.indexOf("item_id");
  if (itemIdx === -1) return out;

  const region = parseInsertValuesRegion(stmt);
  if (!region) return out;

  const tuples = parseValuesTuples(region);
  for (const t of tuples) {
    const parts = splitTopLevelCommaList(t);
    const raw = parts[itemIdx];
    const v = raw ? unquoteSqlString(raw) : null;
    if (v) out.push(v);
  }
  return out;
}

export function runSeedSkinLootItemIdAudit(opts: AuditOpts = {}): SeedSkinLootItemIdAuditResult {
  const resolved = resolveSchemaDir(opts.schemaDir);
  if (!resolved.ok) {
    return {
      schemaDir: "",
      filesScanned: 0,
      seededItemIds: [],
      referencedItemIds: [],
      issues: [{ kind: "schema_dir_missing", schemaDirTried: resolved.tried }],
    };
  }

  const schemaDir = resolved.schemaDir;
  const files = listSqlFiles(schemaDir);

  const seeded = new Set<string>();
  const referenced = new Set<string>();
  const refsByItem = new Map<string, SeedSqlSource[]>();

  for (const f of files) {
    const { sql, source } = readSqlFile(f);

    for (const stmt of extractInsertStatementsForTable(sql, "items")) {
      for (const id of collectSeededItemIdsFromStatement(stmt)) seeded.add(id);
    }

    for (const stmt of extractInsertStatementsForTable(sql, "skin_loot")) {
      for (const itemId of collectReferencedItemIdsFromSkinLootStatement(stmt)) {
        referenced.add(itemId);
        const arr = refsByItem.get(itemId) ?? [];
        if (!arr.find((s) => s.path === source.path)) arr.push(source);
        refsByItem.set(itemId, arr);
      }
    }
  }

  const issues: SeedSkinLootItemIdAuditIssue[] = [];
  for (const itemId of referenced) {
    if (!seeded.has(itemId)) {
      issues.push({
        kind: "missing_seeded_item",
        table: "skin_loot",
        itemId,
        sources: refsByItem.get(itemId) ?? [],
      });
    }
  }

  return {
    schemaDir,
    filesScanned: files.length,
    seededItemIds: Array.from(seeded).sort(),
    referencedItemIds: Array.from(referenced).sort(),
    issues,
  };
}

// CLI: node dist/worldcore/tools/seedSkinLootItemIdAudit.js [--schemaDir <path>] [--json]
if (require.main === module) {
  const argv = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    if (i === -1) return undefined;
    return argv[i + 1];
  };

  const schemaDir = getArg("--schemaDir");
  const asJson = argv.includes("--json");

  const res = runSeedSkinLootItemIdAudit({ schemaDir });

  if (asJson) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.issues.length ? 1 : 0);
  }

  if (res.issues.length) {
    // eslint-disable-next-line no-console
    console.error(`[seedSkinLootItemIdAudit] FAIL: ${res.issues.length} issue(s)`);
    for (const i of res.issues) {
      if (i.kind === "schema_dir_missing") {
        // eslint-disable-next-line no-console
        console.error(`- schema dir missing (tried: ${i.schemaDirTried.join(", ")})`);
        continue;
      }
      // eslint-disable-next-line no-console
      console.error(
        `- skin_loot references missing seeded item '${i.itemId}' (sources: ${i.sources.map((s) => s.file).join(", ")})`,
      );
    }
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`[seedSkinLootItemIdAudit] OK: filesScanned=${res.filesScanned} schemaDir=${res.schemaDir}`);
}
