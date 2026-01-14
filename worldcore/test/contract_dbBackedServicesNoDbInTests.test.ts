// worldcore/test/contract_dbBackedServicesNoDbInTests.test.ts
//
// Contract guard:
// DB-backed services must not statically import Database.ts.
// They must lazy-import it inside methods, and tests must be able to import
// these modules without opening sockets / DNS / hanging node --test.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRootFromDistTestDir(): string {
  // __dirname = <repo>/dist/worldcore/test
  return path.resolve(__dirname, "../../..");
}

function readTextOrFail(p: string): string {
  assert.ok(fs.existsSync(p), `Missing expected file: ${p}`);
  return fs.readFileSync(p, "utf8");
}

function assertNoStaticDbImport(label: string, contents: string) {
  // Ban the usual footguns.
  assert.ok(
    !contents.match(/import\s+\{\s*db\s*\}\s+from\s+["']\.\.\/db\/Database["'];?/),
    `${label}: must not statically import { db } from ../db/Database`,
  );
  assert.ok(
    !contents.includes('from "../db/Database"'),
    `${label}: must not statically import ../db/Database`,
  );
  assert.ok(
    !contents.includes('require("../db/Database")'),
    `${label}: must not require("../db/Database") at module scope`,
  );

  // Require a lazy import pattern so we know it's intentional.
  assert.ok(
    contents.includes('import("../db/Database")'),
    `${label}: expected lazy import("../db/Database")`,
  );
}

test("[contract] DB-backed services do not statically import Database.ts", () => {
  const repoRoot = repoRootFromDistTestDir();

  const spawnPointsPath = path.join(repoRoot, "worldcore", "world", "SpawnPointService.ts");
  const npcPgPath = path.join(repoRoot, "worldcore", "npc", "PostgresNpcService.ts");

  const spawnPoints = readTextOrFail(spawnPointsPath);
  const npcPg = readTextOrFail(npcPgPath);

  assertNoStaticDbImport("SpawnPointService.ts", spawnPoints);
  assertNoStaticDbImport("PostgresNpcService.ts", npcPg);
});
