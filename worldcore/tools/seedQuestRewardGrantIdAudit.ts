// worldcore/tools/seedQuestRewardGrantIdAudit.ts
//
// Audit: ensure quest reward grant ids are valid.
//
// Rules:
// - quest_rewards.kind = 'spell_grant'   => extra_json.spellId must exist in seeded spells catalog
// - quest_rewards.kind = 'ability_grant' => extra_json.abilityId must exist in seeded abilities catalog
//
// Usage (repo root):
//   npm run build --workspace worldcore
//   node dist/worldcore/tools/seedQuestRewardGrantIdAudit.js
//   node dist/worldcore/tools/seedQuestRewardGrantIdAudit.js --schemaDir worldcore/infra/schema
//   node dist/worldcore/tools/seedQuestRewardGrantIdAudit.js --json
//   node dist/worldcore/tools/seedQuestRewardGrantIdAudit.js --allowMissing spell:foo,ability:bar
//
// Exit code: 0 if OK; 1 if missing ids (unless allowed).

/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";

export type SeedQuestRewardGrantIdAuditResult = {
  schemaDir: string;
  filesScanned: number;
  seededSpellIds: number;
  seededAbilityIds: number;
  questSpellGrantIds: number;
  questAbilityGrantIds: number;
  missingSpellIds: string[];
  missingAbilityIds: string[];
};

type AuditOpts = {
  schemaDir?: string;
  json?: boolean;
  allowMissing?: string[]; // entries like "spell:<id>" or "ability:<id>"
};

/**
 * Resolve the schema directory robustly across:
 * - repo root:      <repo>/worldcore/infra/schema
 * - workspace cwd:  <repo>/worldcore
 * - dist runner:    <repo>/worldcore/dist/...
 */
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
  const noLine = sql.replace(/--.*$/gm, "");
  return noLine.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractInsertStatements(
  sql: string,
  tableName: string
): Array<{ columns: string[] | null; valuesChunk: string }> {
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
  if (s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return null;
}

function parseJsonbLiteral(v: string): any | null {
  const s = v.trim();
  if (s.toUpperCase() === "NULL") return null;

  const noCast = s.replace(/::\s*jsonb\s*$/i, "").trim();
  const raw = unquoteSqlString(noCast);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseAllowMissing(list: string[] | undefined): { spell: Set<string>; ability: Set<string> } {
  const spell = new Set<string>();
  const ability = new Set<string>();
  for (const raw of list ?? []) {
    const t = raw.trim();
    if (!t) continue;
    const m = /^(spell|ability)\s*:\s*(.+)$/i.exec(t);
    if (m) {
      const kind = m[1].toLowerCase();
      const id = m[2].trim();
      if (kind === "spell") spell.add(id);
      else ability.add(id);
      continue;
    }
    // Back-compat: raw ids (no prefix) count as allowed for both.
    spell.add(t);
    ability.add(t);
  }
  return { spell, ability };
}

function parseArgs(argv: string[]): AuditOpts {
  const out: AuditOpts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--schemaDir" && argv[i + 1]) {
      out.schemaDir = argv[i + 1];
      i++;
      continue;
    }
    if (a === "--json") {
      out.json = true;
      continue;
    }
    if (a === "--allowMissing" && argv[i + 1]) {
      out.allowMissing = argv[i + 1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      i++;
      continue;
    }
  }
  return out;
}

export function runSeedQuestRewardGrantIdAudit(opts: AuditOpts = {}): SeedQuestRewardGrantIdAuditResult {
  const schemaDir = resolveSchemaDir(opts.schemaDir);
  const files = getFilesRecursive(schemaDir);

  const seededSpellIds = new Set<string>();
  const seededAbilityIds = new Set<string>();
  const questSpellGrantIds = new Set<string>();
  const questAbilityGrantIds = new Set<string>();

  for (const f of files) {
    const sql = fs.readFileSync(f, "utf8");

    // Collect seeded spell ids
    for (const stmt of extractInsertStatements(sql, "spells")) {
      const tuples = splitTopLevelTuples(stmt.valuesChunk);
      for (const t of tuples) {
        const vals = splitTupleValues(t);
        let idIdx = -1;
        if (stmt.columns) idIdx = stmt.columns.findIndex((c) => c.toLowerCase() === "id");
        if (idIdx < 0) idIdx = 0;
        const id = idIdx >= 0 && idIdx < vals.length ? unquoteSqlString(vals[idIdx]) : null;
        if (id) seededSpellIds.add(id);
      }
    }

    // Collect seeded ability ids
    for (const stmt of extractInsertStatements(sql, "abilities")) {
      const tuples = splitTopLevelTuples(stmt.valuesChunk);
      for (const t of tuples) {
        const vals = splitTupleValues(t);
        let idIdx = -1;
        if (stmt.columns) idIdx = stmt.columns.findIndex((c) => c.toLowerCase() === "id");
        if (idIdx < 0) idIdx = 0;
        const id = idIdx >= 0 && idIdx < vals.length ? unquoteSqlString(vals[idIdx]) : null;
        if (id) seededAbilityIds.add(id);
      }
    }

    // Collect quest reward grant ids
    for (const stmt of extractInsertStatements(sql, "quest_rewards")) {
      const tuples = splitTopLevelTuples(stmt.valuesChunk);
      for (const t of tuples) {
        const vals = splitTupleValues(t);

        let kindIdx = -1;
        let extraIdx = -1;

        if (stmt.columns) {
          kindIdx = stmt.columns.findIndex((c) => c.toLowerCase() === "kind");
          extraIdx = stmt.columns.findIndex((c) => c.toLowerCase() === "extra_json");
        } else {
          // quest_rewards: id, quest_id, kind, amount, item_id, item_qty, title_id, extra_json
          if (vals.length >= 8) {
            kindIdx = 2;
            extraIdx = 7;
          }
        }

        const kindRaw = kindIdx >= 0 && kindIdx < vals.length ? unquoteSqlString(vals[kindIdx]) : null;
        if (!kindRaw) continue;
        const kind = kindRaw.trim();

        if (kind !== "spell_grant" && kind !== "ability_grant") continue;

        const extra = extraIdx >= 0 && extraIdx < vals.length ? parseJsonbLiteral(vals[extraIdx]) : null;
        if (!extra || typeof extra !== "object") continue;

        if (kind === "spell_grant") {
          const spellId = (extra as any).spellId ? String((extra as any).spellId) : null;
          if (spellId) questSpellGrantIds.add(spellId);
        } else {
          const abilityId = (extra as any).abilityId ? String((extra as any).abilityId) : null;
          if (abilityId) questAbilityGrantIds.add(abilityId);
        }
      }
    }
  }

  const allow = parseAllowMissing(opts.allowMissing);

  const missingSpellIds = [...questSpellGrantIds]
    .filter((id) => !seededSpellIds.has(id) && !allow.spell.has(id))
    .sort();

  const missingAbilityIds = [...questAbilityGrantIds]
    .filter((id) => !seededAbilityIds.has(id) && !allow.ability.has(id))
    .sort();

  return {
    schemaDir,
    filesScanned: files.length,
    seededSpellIds: seededSpellIds.size,
    seededAbilityIds: seededAbilityIds.size,
    questSpellGrantIds: questSpellGrantIds.size,
    questAbilityGrantIds: questAbilityGrantIds.size,
    missingSpellIds,
    missingAbilityIds,
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const r = runSeedQuestRewardGrantIdAudit(opts);

  const ok = r.missingSpellIds.length === 0 && r.missingAbilityIds.length === 0;

  if (opts.json) {
    console.log(JSON.stringify({ ok, ...r }, null, 2));
  } else {
    const prefix = "[seedQuestRewardGrantIdAudit]";
    if (ok) {
      console.log(
        `${prefix} OK: filesScanned=${r.filesScanned} schemaDir=${r.schemaDir} questSpellGrantIds=${r.questSpellGrantIds} questAbilityGrantIds=${r.questAbilityGrantIds}`
      );
    } else {
      console.error(`${prefix} FAIL: missingSpellIds=${r.missingSpellIds.length} missingAbilityIds=${r.missingAbilityIds.length}`);
      if (r.missingSpellIds.length) console.error(`${prefix} missing spellIds: ${r.missingSpellIds.join(", ")}`);
      if (r.missingAbilityIds.length) console.error(`${prefix} missing abilityIds: ${r.missingAbilityIds.join(", ")}`);
    }
  }

  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
