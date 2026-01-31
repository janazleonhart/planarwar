// worldcore/tools/seedNpcLootItemIdAudit.ts
//
// Seed integrity audit: npc_loot.item_id must reference an item seeded in worldcore/infra/schema.
//
// This audit inspects seed SQL files (not runtime DB state).
// It is designed for CI contract tests and optional CLI use.

import fs from "node:fs";
import path from "node:path";

import {
  ResolveSchemaDirResult,
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

export type SeedNpcLootItemIdAuditIssue =
  | { kind: "schema_dir_missing"; schemaDirTried: string[] }
  | { kind: "missing_seeded_item"; table: "npc_loot"; itemId: string; sources: SeedSqlSource[] };

export type SeedNpcLootItemIdAuditResult = {
  schemaDir: string;
  filesScanned: number;
  seededItemIds: string[];
  referencedItemIds: string[];
  issues: SeedNpcLootItemIdAuditIssue[];
};

export type AuditOpts = {
  schemaDir?: string;
};

function collectSeededItemIdsFromStatement(stmt: string): string[] {
  // INSERT INTO items (id, ...) VALUES ( 'foo', ... ), ( 'bar', ... );
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

function collectReferencedItemIdsFromNpcLootStatement(stmt: string): string[] {
  // INSERT INTO npc_loot (...) VALUES (...);  (also supports public.npc_loot)
  const cols = parseInsertColumnList(stmt);
  const itemIdx = cols.length ? cols.indexOf("item_id") : -1;
  if (itemIdx === -1) return [];

  const region = parseInsertValuesRegion(stmt);
  if (!region) return [];

  const tuples = parseValuesTuples(region);
  const out: string[] = [];
  for (const t of tuples) {
    const parts = splitTopLevelCommaList(t);
    const raw = parts[itemIdx];
    const v = raw ? unquoteSqlString(raw) : null;
    if (v) out.push(v);
  }
  return out;
}

export function runSeedNpcLootItemIdAudit(opts: AuditOpts = {}): SeedNpcLootItemIdAuditResult {
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

    // Seeded items
    for (const stmt of extractInsertStatementsForTable(sql, "items")) {
      for (const id of collectSeededItemIdsFromStatement(stmt)) seeded.add(id);
    }

    // Referenced in npc_loot
    for (const stmt of extractInsertStatementsForTable(sql, "npc_loot")) {
      for (const itemId of collectReferencedItemIdsFromNpcLootStatement(stmt)) {
        referenced.add(itemId);
        const arr = refsByItem.get(itemId) ?? [];
        // avoid dup per file
        if (!arr.find((s) => s.path === source.path)) arr.push(source);
        refsByItem.set(itemId, arr);
      }
    }
  }

  const issues: SeedNpcLootItemIdAuditIssue[] = [];
  for (const itemId of referenced) {
    if (!seeded.has(itemId)) {
      issues.push({
        kind: "missing_seeded_item",
        table: "npc_loot",
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

// CLI: node dist/worldcore/tools/seedNpcLootItemIdAudit.js [--schemaDir <path>] [--json]
if (require.main === module) {
  const argv = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    if (i === -1) return undefined;
    return argv[i + 1];
  };

  const schemaDir = getArg("--schemaDir");
  const asJson = argv.includes("--json");

  const res = runSeedNpcLootItemIdAudit({ schemaDir });

  if (asJson) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.issues.length ? 1 : 0);
  }

  if (res.issues.length) {
    // eslint-disable-next-line no-console
    console.error(`[seedNpcLootItemIdAudit] FAIL: ${res.issues.length} issue(s)`);
    for (const i of res.issues) {
      if (i.kind === "schema_dir_missing") {
        // eslint-disable-next-line no-console
        console.error(`- schema dir missing (tried: ${i.schemaDirTried.join(", ")})`);
        continue;
      }
      // eslint-disable-next-line no-console
      console.error(
        `- npc_loot references missing seeded item '${i.itemId}' (sources: ${i.sources.map((s) => s.file).join(", ")})`,
      );
    }
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`[seedNpcLootItemIdAudit] OK: filesScanned=${res.filesScanned} schemaDir=${res.schemaDir}`);
}
