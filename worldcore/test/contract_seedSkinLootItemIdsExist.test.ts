// worldcore/test/contract_seedSkinLootItemIdsExist.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { runSeedSkinLootItemIdAudit } from "../tools/seedSkinLootItemIdAudit";

test("[contract] skin_loot seed item_id references must exist in seeded items", () => {
  const res = runSeedSkinLootItemIdAudit();
  assert.equal(
    res.issues.length,
    0,
    "seed integrity: " +
      res.issues.length +
      " skin_loot item-id issue(s):\n" +
      res.issues
        .map((i) => {
          if (i.kind === "schema_dir_missing") return `- schema dir missing (tried: ${i.schemaDirTried.join(", ")})`;
          return `- skin_loot item_id '${i.itemId}' missing in items seeds (sources: ${i.sources
            .map((s) => s.file)
            .join(", ")})`;
        })
        .join("\n"),
  );
});
