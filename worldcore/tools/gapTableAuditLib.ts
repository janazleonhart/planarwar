// worldcore/tools/gapTableAuditLib.ts
//
// Milestone B (Gap Table Audit) - Library helpers.
// Goal: lightweight, dependency-free parsing of Postgres-ish SQL to discover table names.
//
// Notes:
// - This is NOT a full SQL parser. It is a robust heuristic for CREATE TABLE / ALTER TABLE statements.
// - Designed to work against our migration SQL under worldcore/infra/schema/*.sql and schema dumps.

export type TableRef = {
  /** normalized lowercase table name without schema */
  name: string;
  /** original raw token as seen in SQL */
  raw: string;
  /** 1-based line number (best effort) */
  line?: number;
};

export function stripSqlComments(sql: string): string {
  // Remove /* ... */ blocks
  let out = sql.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove -- line comments (heuristic; ok for migration/schema dumps)
  out = out.replace(/--.*$/gm, "");
  return out;
}

function normalizeIdent(raw: string): string {
  let s = raw.trim();

  // Drop trailing punctuation
  s = s.replace(/[;,]+$/g, "");

  // Unwrap schema-qualified names: public.foo, "public"."Foo", etc.
  // Also handle quoted identifiers: "Foo"
  s = s.replace(/"/g, "");
  if (s.includes(".")) s = s.split(".").at(-1) ?? s;

  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  return s.toLowerCase();
}

function isUnquotedKeyword(tok: string, keyword: string): boolean {
  const t = tok.trim();
  if (!t) return false;
  // If it's quoted, treat it as an identifier, not a keyword.
  if (t.includes('"')) return false;
  return t.toUpperCase() === keyword.toUpperCase();
}

function pickTableToken(tokens: string[]): string | null {
  let i = 0;

  // Optional IF [NOT] EXISTS prefix (CREATE/ALTER)
  if (tokens[i] && isUnquotedKeyword(tokens[i], "IF")) {
    i++;
    if (tokens[i] && isUnquotedKeyword(tokens[i], "NOT")) i++;
    if (tokens[i] && isUnquotedKeyword(tokens[i], "EXISTS")) i++;
    else if (tokens[i] && isUnquotedKeyword(tokens[i], "EXISTS")) i++;
  }

  // Optional ONLY prefix (ALTER; sometimes seen in dumps)
  if (tokens[i] && isUnquotedKeyword(tokens[i], "ONLY")) i++;

  const tok = tokens[i]?.trim();
  return tok ? tok : null;
}

function extractFromCreateLine(line: string, lineNo: number): TableRef | null {
  const upper = line.toUpperCase();
  const idx = upper.indexOf("CREATE TABLE");
  if (idx < 0) return null;

  const after = line.slice(idx + "CREATE TABLE".length).trim();
  const paren = after.indexOf("(");
  if (paren < 0) return null;

  const head = after.slice(0, paren).trim();
  if (!head) return null;

  const tokens = head.split(/\s+/).filter(Boolean);
  const nameTok = pickTableToken(tokens);
  if (!nameTok) return null;

  return { name: normalizeIdent(nameTok), raw: nameTok, line: lineNo };
}

function extractFromAlterLine(line: string, lineNo: number): TableRef | null {
  const upper = line.toUpperCase();
  const idx = upper.indexOf("ALTER TABLE");
  if (idx < 0) return null;

  const after = line.slice(idx + "ALTER TABLE".length).trim();
  if (!after) return null;

  // Table name ends at first whitespace after the (optional) prefixes and identifier.
  // We can safely token-split the head of the line.
  const tokens = after.split(/\s+/).filter(Boolean);
  const nameTok = pickTableToken(tokens);
  if (!nameTok) return null;

  return { name: normalizeIdent(nameTok), raw: nameTok, line: lineNo };
}

export function extractTableRefsFromSql(sql: string): TableRef[] {
  const cleaned = stripSqlComments(sql);
  const lines = cleaned.split(/\r?\n/);

  const refs: TableRef[] = [];

  // Line-by-line scanning preserves line numbers (best effort).
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i];

    const c = extractFromCreateLine(line, lineNo);
    if (c) refs.push(c);

    const a = extractFromAlterLine(line, lineNo);
    if (a) refs.push(a);
  }

  // De-dup while preserving first seen order
  const seen = new Set<string>();
  const out: TableRef[] = [];
  for (const r of refs) {
    if (!r.name) continue;
    if (seen.has(r.name)) continue;
    seen.add(r.name);
    out.push(r);
  }
  return out;
}

export function extractTableNamesFromSql(sql: string): string[] {
  return extractTableRefsFromSql(sql).map((r) => r.name);
}
