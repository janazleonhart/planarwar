// worldcore/tools/auditNpcLawTags.ts
/* eslint-disable no-console */

import { db } from "../db/Database";
import { Logger } from "../utils/logger";

type Args = {
  fix: boolean;
  commit: boolean;
  json: boolean;
  idPrefix?: string;

  // Hardening flags:
  failOnIssues: boolean;
  failOnFixable: boolean;
  minRows: number;
};

type NpcRow = {
  id: string;
  name: string;
  tags: string[] | null;
};

type IssueCode =
  | "alias_law_tag"
  | "law_conflict_exempt_and_protected"
  | "law_exempt_with_protection_tags"
  | "law_protected_with_legacy_protection_tags"
  | "guard_has_law_tags"
  | "resource_has_law_tags"
  | "duplicate_or_blank_tags";

type AuditRow = {
  id: string;
  name: string;
  tags: string[];
  issues: IssueCode[];
  suggestedTags: string[];
  willChange: boolean;
};

const log = Logger.scope("NPC_AUDIT");

// Canonical tags used by schema + runtime (NpcCrime.ts).
const LAW_EXEMPT = "law_exempt";
const LAW_PROTECTED = "law_protected";

// Legacy/default “protected” tags (still honored unless overridden by law_exempt).
const PROTECTION_TAGS = new Set<string>([
  "civilian",
  "protected",
  "vendor",
  "questgiver",
  "non_hostile",
  "protected_town",
  "protected_outpost",
  "protected_wilds",
]);

// Accept common alias forms (handoff notes, muscle memory, etc.)
const LAW_ALIASES: Record<string, string> = {
  "law:exempt": LAW_EXEMPT,
  "law:protected": LAW_PROTECTED,
  "law-exempt": LAW_EXEMPT,
  "law-protected": LAW_PROTECTED,
};

function printHelpAndExit(code: number): never {
  console.log(
    `
Planar War — NPC Law Tag Audit

Usage:
  node dist/worldcore/tools/auditNpcLawTags.js [--json] [--idPrefix <prefix>]
  node dist/worldcore/tools/auditNpcLawTags.js --fix [--commit] [--idPrefix <prefix>]

Hardening options (for CI / drift prevention):
  --failOnIssues        exit non-zero if any NPC has issues
  --failOnFixable       exit non-zero if any NPC would be changed by safe cleanup
  --minRows <n>         exit non-zero if fewer than n NPC rows are loaded (catches wrong DB)

Behavior:
  - Reads Postgres table: npcs(id, name, tags text[])
  - Detects contradictory or misleading tag combos
  - --fix applies safe cleanups (normalizes aliases, removes redundant tags under explicit law_* rules)
  - Without --commit, --fix runs inside a transaction and ROLLS BACK (dry run)

Options:
  --json              output machine-readable JSON
  --idPrefix <p>      only audit NPC ids starting with prefix
  --fix               apply suggested tag cleanups
  --commit            commit DB changes (only meaningful with --fix)
  --help | -h
`.trim(),
  );
  process.exit(code);
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    fix: false,
    commit: false,
    json: false,
    failOnIssues: false,
    failOnFixable: false,
    minRows: 0,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i] ?? "";

    if (a === "--json") out.json = true;
    else if (a === "--fix") out.fix = true;
    else if (a === "--commit") out.commit = true;
    else if (a === "--failOnIssues") out.failOnIssues = true;
    else if (a === "--failOnFixable") out.failOnFixable = true;
    else if (a === "--idPrefix") {
      const next = argv[i + 1];
      if (!next) throw new Error("Missing value for --idPrefix");
      out.idPrefix = next;
      i++;
    } else if (a === "--minRows") {
      const next = argv[i + 1];
      if (!next) throw new Error("Missing value for --minRows");
      const n = Number(next);
      if (!Number.isFinite(n) || n < 0) throw new Error("--minRows must be a non-negative number");
      out.minRows = Math.floor(n);
      i++;
    } else if (a === "--help" || a === "-h") {
      printHelpAndExit(0);
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }

  return out;
}

function normalizeTags(
  raw: string[] | null | undefined,
): { tags: string[]; hadJunk: boolean; hadAliases: boolean } {
  const input = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  const seen = new Set<string>();
  let hadJunk = false;
  let hadAliases = false;

  for (const v of input) {
    const trimmed = String(v ?? "").trim();
    if (!trimmed) {
      hadJunk = true;
      continue;
    }

    const mapped = LAW_ALIASES[trimmed] ?? trimmed;
    if (mapped !== trimmed) hadAliases = true;

    if (seen.has(mapped)) {
      hadJunk = true;
      continue;
    }
    seen.add(mapped);
    out.push(mapped);
  }

  return { tags: out, hadJunk, hadAliases };
}

function isResource(tags: Set<string>): boolean {
  if (tags.has("resource")) return true;
  for (const t of tags) {
    if (t.startsWith("resource_")) return true;
  }
  return false;
}

function analyzeNpc(row: NpcRow): AuditRow {
  const normalized = normalizeTags(row.tags);
  const tags = normalized.tags;
  const set = new Set(tags);

  const issues: IssueCode[] = [];

  if (normalized.hadAliases) issues.push("alias_law_tag");
  if (normalized.hadJunk) issues.push("duplicate_or_blank_tags");

  const hasExempt = set.has(LAW_EXEMPT);
  const hasProtected = set.has(LAW_PROTECTED);
  const hasGuard = set.has("guard");
  const hasResource = isResource(set);

  let hasProtectionTags = false;
  for (const t of set) {
    if (PROTECTION_TAGS.has(t)) {
      hasProtectionTags = true;
      break;
    }
  }

  if (hasExempt && hasProtected) issues.push("law_conflict_exempt_and_protected");
  if (hasExempt && hasProtectionTags) issues.push("law_exempt_with_protection_tags");
  if (!hasExempt && hasProtected && hasProtectionTags) issues.push("law_protected_with_legacy_protection_tags");
  if (hasGuard && (hasExempt || hasProtected)) issues.push("guard_has_law_tags");
  if (hasResource && (hasExempt || hasProtected)) issues.push("resource_has_law_tags");

  // Suggested cleanup rules:
  // - Normalize aliases (handled above)
  // - If law_exempt present: remove law_protected and remove protection tags (exempt wins anyway)
  // - If guard/resource: remove law_* tags (runtime treats them as non-protected anyway)
  // - If law_protected present: remove legacy protection tags (protected is explicit)
  const suggested = [...tags];
  const suggestedSet = new Set(suggested);

  if (hasExempt) {
    suggestedSet.delete(LAW_PROTECTED);
    for (const t of Array.from(suggestedSet)) {
      if (PROTECTION_TAGS.has(t)) suggestedSet.delete(t);
    }
  }

  if (hasProtected && !hasExempt) {
    for (const t of Array.from(suggestedSet)) {
      if (PROTECTION_TAGS.has(t)) suggestedSet.delete(t);
    }
  }

  if (hasGuard || hasResource) {
    suggestedSet.delete(LAW_EXEMPT);
    suggestedSet.delete(LAW_PROTECTED);
  }

  // Preserve original order where possible.
  const suggestedOrdered: string[] = [];
  const seen = new Set<string>();
  for (const t of suggested) {
    if (suggestedSet.has(t) && !seen.has(t)) {
      suggestedOrdered.push(t);
      seen.add(t);
    }
  }
  for (const t of Array.from(suggestedSet)) {
    if (!seen.has(t)) suggestedOrdered.push(t);
  }

  const willChange = tags.join("|") !== suggestedOrdered.join("|");

  return {
    id: row.id,
    name: row.name,
    tags,
    issues,
    suggestedTags: suggestedOrdered,
    willChange,
  };
}

async function loadNpcs(idPrefix?: string): Promise<NpcRow[]> {
  if (idPrefix && idPrefix.trim()) {
    const res = await db.query(`SELECT id, name, tags FROM npcs WHERE id LIKE $1 ORDER BY id`, [`${idPrefix}%`]);
    return res.rows as NpcRow[];
  }

  const res = await db.query(`SELECT id, name, tags FROM npcs ORDER BY id`);
  return res.rows as NpcRow[];
}

async function applyFixes(rows: AuditRow[], commit: boolean): Promise<{ updated: number }> {
  const fixable = rows.filter((r) => r.willChange);
  if (fixable.length === 0) return { updated: 0 };

  // IMPORTANT: Transactions must run on a single client.
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const r of fixable) {
      await client.query(`UPDATE npcs SET tags = $2 WHERE id = $1`, [r.id, r.suggestedTags]);
    }

    if (commit) await client.query("COMMIT");
    else await client.query("ROLLBACK");

    return { updated: fixable.length };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv);
  } catch (err: any) {
    log.error(String(err?.message ?? err));
    printHelpAndExit(1);
  }

  const npcs = await loadNpcs(args.idPrefix);
  const audited = npcs.map(analyzeNpc);

  const withIssues = audited.filter((r) => r.issues.length > 0);
  const fixable = audited.filter((r) => r.willChange);

  // Sanity checks (catch wrong DB early)
  if (args.minRows > 0 && audited.length < args.minRows) {
    log.error("Loaded fewer NPC rows than expected.", {
      loaded: audited.length,
      minRows: args.minRows,
      hint: "This often means you're pointed at the wrong database or the table isn't seeded.",
    });
    // Still print output so you can see what it DID connect to.
  } else if (audited.length <= 10) {
    log.warn("NPC row count is very small. If you expected a populated DB, verify PW_DB_NAME / shard seed.", {
      loaded: audited.length,
    });
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          total: audited.length,
          withIssues: withIssues.length,
          fixable: fixable.length,
          rows: audited,
        },
        null,
        2,
      ),
    );
  } else {
    log.info("NPC rows loaded:", audited.length);
    log.info("Rows with issues:", withIssues.length);
    log.info("Rows fixable via safe cleanup:", fixable.length);

    for (const r of withIssues) {
      log.warn(`${r.id} (${r.name})`, {
        tags: r.tags,
        issues: r.issues,
        suggestedTags: r.suggestedTags,
        willChange: r.willChange,
      });
    }
  }

  if (args.fix) {
    const { updated } = await applyFixes(audited, args.commit);
    if (args.commit) {
      log.success("Applied NPC tag cleanups (COMMITTED).", { updated });
    } else {
      log.warn("Applied NPC tag cleanups (ROLLED BACK — dry run).", { updated });
      log.warn("Re-run with --fix --commit to persist.");
    }
  }

  // CI / guardrail exit codes
  if (args.minRows > 0 && audited.length < args.minRows) return 3;
  if (args.failOnIssues && withIssues.length > 0) return 2;
  if (args.failOnFixable && fixable.length > 0) return 2;

  return 0;
}

main()
  .then(async (code) => {
    try {
      await db.end();
    } catch {
      // ignore
    }
    process.exit(code);
  })
  .catch(async (err) => {
    log.error("NPC audit failed", { err });
    try {
      await db.end();
    } catch {
      // ignore
    }
    process.exit(1);
  });
