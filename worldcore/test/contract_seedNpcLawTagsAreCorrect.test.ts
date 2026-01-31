// worldcore/test/contract_seedNpcLawTagsAreCorrect.test.ts
//
// Contract seatbelt: NPC seed law-tag invariants.
// This inspects seed SQL in worldcore/infra/schema — not runtime DB state.

import assert from "node:assert/strict";
import test from "node:test";
import { runSeedNpcLawTagsAudit } from "../tools/seedNpcLawTagsAudit";

test("[contract] NPC seed law tags preserve training dummy safety + protected civilians", () => {
  const res = runSeedNpcLawTagsAudit();

  if (res.issues.length) {
    const msg =
      `seed integrity: ${res.issues.length} npc law-tag issue(s):\n` +
      res.issues
        .map((i) => {
          if (i.kind === "schema_dir_missing") {
            return `- schema dir missing (tried: ${i.schemaDirTried.join(", ")})`;
          }
          if (i.kind === "missing_seed_row") {
            return `- missing seed row for '${i.npcId}'`;
          }
          if (i.kind === "missing_tag") {
            return `- ${i.npcId} missing tag '${i.tag}' (tags: ${i.tags.join(",")})`;
          }
          if (i.kind === "forbidden_tag") {
            return `- ${i.npcId} has forbidden tag '${i.tag}' (tags: ${i.tags.join(",")})`;
          }
          return `- ${JSON.stringify(i)}`;
        })
        .join("\n");

    assert.equal(res.issues.length, 0, msg);
  }

  assert.equal(res.issues.length, 0);
});
