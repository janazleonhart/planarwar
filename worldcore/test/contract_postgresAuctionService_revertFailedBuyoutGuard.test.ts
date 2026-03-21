// worldcore/test/contract_postgresAuctionService_revertFailedBuyoutGuard.test.ts
// Contract: revertFailedBuyout must only revert the matching sold row for the same shard+buyer.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function findRepoRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    if (fs.existsSync(path.join(current, "worldcore", "auction", "PostgresAuctionService.ts"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Unable to locate repo root from ${startDir}`);
}

test("[contract] postgres auction revert failed buyout is shard+buyer bound", () => {
  const repoRoot = findRepoRoot(__dirname);
  const file = path.join(repoRoot, "worldcore", "auction", "PostgresAuctionService.ts");
  assert.ok(fs.existsSync(file), `Missing expected file: ${file}`);
  const src = fs.readFileSync(file, "utf8");

  assert.match(
    src,
    /async\s+revertFailedBuyout\s*\(args:\s*\{[\s\S]*?id:\s*number;[\s\S]*?shardId:\s*string;[\s\S]*?buyerCharId:\s*string;[\s\S]*?\}\)\s*:\s*Promise<AuctionListing\s*\|\s*null>\s*\{[\s\S]*?UPDATE auctions[\s\S]*?SET status = 'active',[\s\S]*?buyer_char_id = NULL,[\s\S]*?buyer_char_name = NULL,[\s\S]*?sold_at = NULL,[\s\S]*?proceeds_gold = NULL[\s\S]*?WHERE id = \$1[\s\S]*?AND shard_id = \$2[\s\S]*?AND status = 'sold'[\s\S]*?AND buyer_char_id = \$3[\s\S]*?AND proceeds_claimed = false[\s\S]*?RETURNING \*/m,
  );
});
