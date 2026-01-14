import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("[contract] MudResultPayload supports event: death|respawn", () => {
  const p = path.resolve(process.cwd(), "shared/messages.ts");
  const src = fs.readFileSync(p, "utf8");

  assert.ok(
    src.includes("export interface MudResultPayload"),
    "messages.ts must define MudResultPayload",
  );

  // Keep it simple + explicit: the union is the contract.
  assert.ok(
    src.includes('event?: "death" | "respawn"'),
    'MudResultPayload.event must remain: "death" | "respawn"',
  );
});
