// worldcore/test/contract_postgresAuctionService_cancelListingShardGuard.test.ts
// Contract: cancelListing must be shard-bound at the DB boundary.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function findRepoRoot(startDir: string): string {
  let current = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Could not locate repo root from ${startDir}`);
    }
    current = parent;
  }
}

test("[contract] postgres auction cancel query is shard-bound", () => {
  const repoRoot = findRepoRoot(__dirname);
  const sourcePath = path.join(
    repoRoot,
    "worldcore",
    "auction",
    "PostgresAuctionService.ts"
  );

  assert.ok(fs.existsSync(sourcePath), `Missing expected file: ${sourcePath}`);
  const source = fs.readFileSync(sourcePath, "utf8");

  assert.match(
    source,
    /async\s+cancelListing\s*\(args:\s*\{[\s\S]*?id:\s*number;[\s\S]*?shardId:\s*string;[\s\S]*?sellerCharId:\s*string;[\s\S]*?\}\)\s*:\s*Promise<AuctionListing\s*\|\s*null>\s*\{[\s\S]*?UPDATE auctions[\s\S]*?SET status = 'cancelled'[\s\S]*?WHERE id = \$1[\s\S]*?AND shard_id = \$2[\s\S]*?AND seller_char_id = \$3[\s\S]*?AND status = 'active'[\s\S]*?RETURNING \*/m
  );
});
