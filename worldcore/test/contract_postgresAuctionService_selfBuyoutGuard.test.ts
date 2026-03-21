// worldcore/test/contract_postgresAuctionService_selfBuyoutGuard.test.ts
// Contract guard: Postgres auction buyout must refuse seller self-purchase at the DB boundary.
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

test("[contract] postgres auction buyout query blocks seller self-purchase", () => {
  const repoRoot = resolveRepoRoot();
  const servicePath = path.join(repoRoot, "worldcore", "auction", "PostgresAuctionService.ts");
  const src = readTextOrFail(servicePath);

  assert.match(
    src,
    /async\s+buyout\s*\(args:\s*\{[\s\S]*?buyerCharId:\s*string;[\s\S]*?\}\)\s*:\s*Promise<AuctionListing\s*\|\s*null>\s*\{[\s\S]*?UPDATE auctions[\s\S]*?WHERE id = \$1[\s\S]*?AND shard_id = \$2[\s\S]*?AND status = 'active'[\s\S]*?AND seller_char_id <> \$3[\s\S]*?RETURNING \*/m,
    "PostgresAuctionService.buyout should block seller self-purchase in the UPDATE predicate",
  );

  assert.match(
    src,
    /\[args\.id,\s*args\.shardId,\s*args\.buyerCharId,\s*args\.buyerCharName\]/m,
    "PostgresAuctionService.buyout should bind buyerCharId as the self-buy guard parameter",
  );
});
