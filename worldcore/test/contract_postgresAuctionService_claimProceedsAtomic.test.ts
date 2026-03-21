// worldcore/test/contract_postgresAuctionService_claimProceedsAtomic.test.ts
// Contract guard: claiming auction proceeds must be atomic so concurrent claims cannot double-pay.
// Structural/source-based: resolves against the repo source tree rather than dist output.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function resolveRepoRoot(): string {
  const fromHere = path.resolve(__dirname, "../../..");
  const sourcePath = path.join(fromHere, "worldcore", "auction", "PostgresAuctionService.ts");
  if (fs.existsSync(sourcePath)) return fromHere;

  const fallback = path.resolve(__dirname, "../..");
  const fallbackPath = path.join(fallback, "worldcore", "auction", "PostgresAuctionService.ts");
  if (fs.existsSync(fallbackPath)) return fallback;

  return fromHere;
}

function readTextOrFail(p: string): string {
  assert.ok(fs.existsSync(p), `Missing expected file: ${p}`);
  return fs.readFileSync(p, "utf8");
}

test("[contract] postgres auction claimProceeds updates and sums in one atomic statement", () => {
  const repoRoot = resolveRepoRoot();
  const servicePath = path.join(repoRoot, "worldcore", "auction", "PostgresAuctionService.ts");
  const src = readTextOrFail(servicePath);

  assert.match(
    src,
    /async\s+claimProceeds\s*\(args:\s*\{[\s\S]*?sellerCharId:\s*string;[\s\S]*?\}\)\s*:\s*Promise<number>\s*\{[\s\S]*?WITH claimed AS \([\s\S]*?UPDATE auctions[\s\S]*?SET proceeds_claimed = true[\s\S]*?WHERE shard_id = \$1[\s\S]*?AND seller_char_id = \$2[\s\S]*?AND status = 'sold'[\s\S]*?AND proceeds_gold IS NOT NULL[\s\S]*?AND proceeds_claimed = false[\s\S]*?RETURNING proceeds_gold[\s\S]*?\)[\s\S]*?SELECT COALESCE\(SUM\(proceeds_gold\), 0\) AS total[\s\S]*?FROM claimed/m,
    "PostgresAuctionService.claimProceeds should atomically mark proceeds claimed and sum only the rows it updated",
  );

  assert.doesNotMatch(
    src,
    /SELECT SUM\(proceeds_gold\) AS sum[\s\S]*?UPDATE auctions[\s\S]*?SET proceeds_claimed = true/m,
    "PostgresAuctionService.claimProceeds should not use a race-prone sum-then-update flow",
  );
});
