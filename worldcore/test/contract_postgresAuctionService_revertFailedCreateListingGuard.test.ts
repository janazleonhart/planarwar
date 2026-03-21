// worldcore/test/contract_postgresAuctionService_revertFailedCreateListingGuard.test.ts
// Contract: revertFailedCreateListing must delete only the matching just-created active row for the same shard+seller.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function findRepoRoot(start: string): string {
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, "worldcore", "auction", "PostgresAuctionService.ts");
    if (fs.existsSync(candidate)) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error("Could not locate repo root from test path.");
    current = parent;
  }
}

test("[contract] postgres auction revert failed create listing is shard+seller bound", () => {
  const repoRoot = findRepoRoot(__dirname);
  const file = path.join(repoRoot, "worldcore", "auction", "PostgresAuctionService.ts");
  assert.ok(fs.existsSync(file), `Missing expected file: ${file}`);
  const src = fs.readFileSync(file, "utf8");

  assert.match(
    src,
    /async\s+revertFailedCreateListing\s*\(args:\s*\{[\s\S]*?id:\s*number;[\s\S]*?shardId:\s*string;[\s\S]*?sellerCharId:\s*string;[\s\S]*?\}\)\s*:\s*Promise<boolean>\s*\{[\s\S]*?DELETE FROM auctions[\s\S]*?WHERE id = \$1[\s\S]*?AND shard_id = \$2[\s\S]*?AND seller_char_id = \$3[\s\S]*?AND status = 'active'[\s\S]*?AND buyer_char_id IS NULL[\s\S]*?AND proceeds_gold IS NULL/m,
    "Expected revertFailedCreateListing to delete only the matching unsold active row for the same shard and seller."
  );
});
