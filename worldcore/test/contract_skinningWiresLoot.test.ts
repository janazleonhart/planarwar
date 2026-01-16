// worldcore/test/contract_skinningWiresLoot.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function mustAnyMatch(src: string, patterns: RegExp[], msg: string): void {
  const ok = patterns.some((p) => p.test(src));
  assert.ok(ok, msg);
}

function mustMatch(src: string, pattern: RegExp, msg: string): void {
  assert.ok(pattern.test(src), msg);
}

test("[contract] skinning command must grant loot and mark corpses as skinned", () => {
  const p = resolve(
    process.cwd(),
    "../worldcore/mud/commands/gathering/skinningCommand.ts"
  );
  const src = readFileSync(p, "utf8");

  // Must locate targets from the room / nearby entities.
  mustAnyMatch(
    src,
    [
      /getRoomEntities\s*\(/,
      /room\.entities\b/,
      /ctx\.rooms\b/,
      /target\w*From\w*Room/i,
    ],
    "skinningCommand must scan room entities"
  );

  // Must write back a 'skinned' marker so repeat skin attempts fail.
  mustAnyMatch(
    src,
    [/\.skinned\s*=\s*true\b/, /set\w*Skinned\s*\(/i, /mark\w*Skinned\s*\(/i],
    "skinningCommand must mark corpse as skinned"
  );

  // Must actually deliver items to the player.
  // We accept either the legacy direct inventory path or the newer centralized
  // overflow helper.
  mustAnyMatch(
    src,
    [
      /\baddItemToBags\s*\(/,
      /\baddToInventory\s*\(/,
      /\bdeliverItemToBagsOrMail\s*\(/,
      /\bdeliverItemsToBagsOrMail\s*\(/,
    ],
    "skinningCommand must add items to inventory/bags"
  );

  // Must emit a progression event for skins (quests/titles hooks).
  mustAnyMatch(
    src,
    [
      /applyProgressionForEvent\s*\(/,
      /emitProgress\w*\s*\(/,
      /Progression\w*Event/i,
    ],
    "skinningCommand must emit a progression event"
  );

  // Should include the word "skinning" in output (UX consistency).
  mustMatch(src, /\[skinning\]/, "skinningCommand should prefix output with [skinning]");
});
