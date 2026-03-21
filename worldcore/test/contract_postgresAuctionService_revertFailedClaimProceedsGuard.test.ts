// worldcore/test/contract_postgresAuctionService_revertFailedClaimProceedsGuard.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function resolveRepoRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    const candidate = path.join(current, "worldcore", "auction", "PostgresAuctionService.ts");
    if (fs.existsSync(candidate)) return current;
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Could not resolve repo root from ${startDir}`);
    }
    current = parent;
  }
}

test("[contract] postgres auction revertFailedClaimProceeds only unclaims the exact seller-owned rows", () => {
  const repoRoot = resolveRepoRoot(__dirname);
  const servicePath = path.join(repoRoot, "worldcore", "auction", "PostgresAuctionService.ts");
  assert.ok(fs.existsSync(servicePath), `Missing expected file: ${servicePath}`);

  const source = fs.readFileSync(servicePath, "utf8");

  assert.match(
    source,
    /async\s+revertFailedClaimProceeds\s*\(args:\s*\{[\s\S]*?shardId:\s*string;[\s\S]*?sellerCharId:\s*string;[\s\S]*?listingIds:\s*number\[\];[\s\S]*?\}\)\s*:\s*Promise<number>\s*\{[\s\S]*?UPDATE auctions[\s\S]*?SET proceeds_claimed = false[\s\S]*?WHERE shard_id = \$1[\s\S]*?AND seller_char_id = \$2[\s\S]*?AND id = ANY\(\$3::int\[\]\)[\s\S]*?AND status = 'sold'[\s\S]*?AND proceeds_gold IS NOT NULL[\s\S]*?AND proceeds_claimed = true/m,
    "Expected revertFailedClaimProceeds to unclaim only the matching seller-owned sold rows for the same shard and explicit id set."
  );
});
