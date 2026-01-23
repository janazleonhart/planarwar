// worldcore/tools/auditVendorTags.ts
//
// Audit + migrate vendor tags in public.npcs.tags
// Canonical vendor tag: "vendor"
// Legacy vendor tag:    "service_vendor"
//
// Usage:
//   node dist/worldcore/tools/auditVendorTags.js
//   node dist/worldcore/tools/auditVendorTags.js --apply
//   node dist/worldcore/tools/auditVendorTags.js --apply --removeLegacy
//   node dist/worldcore/tools/auditVendorTags.js --limit=50
//
// Notes:
// - Default is dry-run: prints counts + sample rows.
// - --apply adds "vendor" where "service_vendor" exists but "vendor" is missing.
// - --removeLegacy removes "service_vendor" only when "vendor" already exists.

import { db } from "../db/Database";

type Args = {
  apply: boolean;
  removeLegacy: boolean;
  limit: number;
};

function parseArgs(argv: string[]): Args {
  let apply = false;
  let removeLegacy = false;
  let limit = 25;

  for (const raw of argv) {
    const a = String(raw || "").trim();
    if (!a) continue;

    if (a === "--apply") apply = true;
    else if (a === "--removeLegacy") removeLegacy = true;
    else if (a.startsWith("--limit=")) {
      const n = Number(a.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
    }
  }

  if (limit < 1) limit = 1;
  if (limit > 200) limit = 200;

  return { apply, removeLegacy, limit };
}

function line(s = "") {
  process.stdout.write(s + "\n");
}

async function scalarInt(sql: string, params: any[] = []): Promise<number> {
  const r = await db.query(sql, params);
  const v = r.rows?.[0];
  const n = Number(v ? Object.values(v)[0] : 0);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  line("[auditVendorTags] table=npcs column=tags");
  line(`[auditVendorTags] mode=${args.apply ? "APPLY" : "DRY_RUN"} removeLegacy=${args.removeLegacy} limit=${args.limit}`);
  line("");

  const total = await scalarInt(`SELECT COUNT(*)::int FROM npcs`);
  const hasLegacy = await scalarInt(
    `SELECT COUNT(*)::int FROM npcs WHERE tags @> ARRAY['service_vendor']::text[]`
  );
  const hasVendor = await scalarInt(
    `SELECT COUNT(*)::int FROM npcs WHERE tags @> ARRAY['vendor']::text[]`
  );
  const legacyOnly = await scalarInt(
    `SELECT COUNT(*)::int FROM npcs
     WHERE tags @> ARRAY['service_vendor']::text[]
       AND NOT (tags @> ARRAY['vendor']::text[])`
  );

  line(`Total NPC rows:              ${total}`);
  line(`Has legacy service_vendor:   ${hasLegacy}`);
  line(`Has canonical vendor:        ${hasVendor}`);
  line(`Needs migration (legacy-only): ${legacyOnly}`);
  line("");

  // Sample rows that need migration.
  const sample = await db.query(
    `
    SELECT id, proto_id, tags
    FROM npcs
    WHERE tags @> ARRAY['service_vendor']::text[]
      AND NOT (tags @> ARRAY['vendor']::text[])
    ORDER BY id
    LIMIT $1
    `,
    [args.limit]
  );

  if ((sample.rows?.length ?? 0) === 0) {
    line("Sample (legacy-only): none ✅");
  } else {
    line("Sample (legacy-only):");
    for (const r of sample.rows) {
      line(`- id=${r.id} proto_id=${r.proto_id} tags=${JSON.stringify(r.tags ?? [])}`);
    }
  }

  if (!args.apply) {
    line("");
    line("Dry-run complete. Re-run with --apply to migrate legacy tags.");
    process.exit(0);
    return;
  }

  line("");
  line("Applying migration (add 'vendor' where missing)…");

  await db.query("BEGIN");
  try {
    const up1 = await db.query(
      `
      UPDATE npcs
      SET tags = (
        SELECT ARRAY(
          SELECT DISTINCT t
          FROM unnest(tags || ARRAY['vendor']::text[]) AS t
          WHERE t IS NOT NULL AND t <> ''
          ORDER BY t
        )
      )
      WHERE tags @> ARRAY['service_vendor']::text[]
        AND NOT (tags @> ARRAY['vendor']::text[])
      RETURNING id
      `
    );

    const migrated = up1.rows?.length ?? 0;
    line(`Migrated rows: ${migrated}`);

    if (args.removeLegacy) {
      line("Removing legacy tag 'service_vendor' where canonical 'vendor' exists…");
      const up2 = await db.query(
        `
        UPDATE npcs
        SET tags = array_remove(tags, 'service_vendor')
        WHERE tags @> ARRAY['vendor']::text[]
          AND tags @> ARRAY['service_vendor']::text[]
        RETURNING id
        `
      );
      const cleaned = up2.rows?.length ?? 0;
      line(`Cleaned rows:  ${cleaned}`);
    }

    await db.query("COMMIT");
    line("Done ✅");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

main().catch((e) => {
  process.stderr.write(`[auditVendorTags] ERROR: ${e?.message ?? String(e)}\n`);
  process.exit(1);
});
