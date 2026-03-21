// worldcore/test/contract_postgresAuctionService_reclaimExpiredListingGuard.test.ts
// Contract: reclaimExpiredListing must mark one seller-owned expired listing at a time.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function findRepoRoot(start: string): string {
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, "worldcore", "auction", "PostgresAuctionService.ts");
    if (fs.existsSync(candidate)) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Could not locate repo root from ${start}`);
    current = parent;
  }
}

test("[contract] postgres auction reclaim marks one expired seller-owned listing", () => {
  const repoRoot = findRepoRoot(__dirname);
  const file = path.join(repoRoot, "worldcore", "auction", "PostgresAuctionService.ts");
  assert.equal(fs.existsSync(file), true, `Missing expected file: ${file}`);
  const src = fs.readFileSync(file, "utf8");

  assert.match(
    src,
    /async\s+reclaimExpiredListing\s*\(args:\s*\{[\s\S]*?id:\s*number;[\s\S]*?shardId:\s*string;[\s\S]*?sellerCharId:\s*string;[\s\S]*?\}\)\s*:\s*Promise<AuctionListing\s*\|\s*null>\s*\{[\s\S]*?UPDATE auctions[\s\S]*?SET items_reclaimed = true[\s\S]*?WHERE id = \$1[\s\S]*?AND shard_id = \$2[\s\S]*?AND seller_char_id = \$3[\s\S]*?AND status = 'expired'[\s\S]*?AND items_reclaimed = false[\s\S]*?RETURNING \*/m
  );
});
