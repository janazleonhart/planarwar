// worldcore/test/skinningFallbackLoot.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { applyFallbackSkinLoot } from "../mud/actions/MudWorldActions";

test("[smoke] skinning fallback loot returns starter hide", () => {
  const fb = applyFallbackSkinLoot("town_rat");
  assert.ok(fb);
  assert.equal(fb.itemId, "hide_scraps");
  assert.ok(fb.minQty >= 1);
  assert.ok(fb.maxQty >= fb.minQty);
});
