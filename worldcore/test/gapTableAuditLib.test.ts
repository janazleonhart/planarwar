// worldcore/test/gapTableAuditLib.test.ts
//
// Unit tests for gap table audit SQL table-name extraction.
// Keeps Milestone B tool stable and prevents regressions from "clever" refactors.

import assert from "node:assert/strict";
import test from "node:test";

import { extractTableNamesFromSql } from "../tools/gapTableAuditLib";

test("[gapTableAudit] extracts CREATE TABLE names (schema-qualified + quoted)", () => {
  const sql = `
    -- comment
    CREATE TABLE public.foo (
      id TEXT
    );
    CREATE TABLE IF NOT EXISTS "public"."BarBaz" (
      id TEXT
    );
  `;
  const names = extractTableNamesFromSql(sql);
  assert.ok(names.includes("foo"));
  assert.ok(names.includes("barbaz"));
});

test("[gapTableAudit] extracts ALTER TABLE names and ignores ONLY keyword", () => {
  const sql = `
    ALTER TABLE ONLY public.players ADD COLUMN hp INT;
    ALTER TABLE IF EXISTS "public"."Guilds" ADD COLUMN name TEXT;
  `;
  const names = extractTableNamesFromSql(sql);
  assert.ok(names.includes("players"));
  assert.ok(names.includes("guilds"));
});

test("[gapTableAudit] de-dups table names across repeated statements", () => {
  const sql = `
    CREATE TABLE public.items (id text);
    ALTER TABLE public.items ADD COLUMN name text;
  `;
  const names = extractTableNamesFromSql(sql);
  const items = names.filter((n) => n === "items");
  assert.equal(items.length, 1);
});
