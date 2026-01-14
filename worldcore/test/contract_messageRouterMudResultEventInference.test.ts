import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("[contract] MessageRouter infers mud_result event for respawn/death", () => {
  const p = path.resolve(process.cwd(), "core/MessageRouter.ts");
  const src = fs.readFileSync(p, "utf8");

  assert.ok(
    src.includes("export function inferMudResultEvent"),
    "MessageRouter must export inferMudResultEvent(...)"
  );

  // Respawn inferred from command verb (stable).
  assert.ok(
    src.includes('verb === "respawn"'),
    'inferMudResultEvent must infer respawn from verb === "respawn"'
  );

  // Death inferred from canonical marker.
  assert.ok(
    src.includes('txt.includes("You die.")'),
    'inferMudResultEvent must infer death from "You die." marker'
  );

  // Ensure mud_result send path attaches optional event.
  assert.ok(
    src.includes("const event = inferMudResultEvent(text, replyText);"),
    "MessageRouter must call inferMudResultEvent(text, replyText) in mud send path"
  );

  assert.ok(
    src.includes("if (event) mudPayload.event = event;"),
    "MessageRouter must attach mudPayload.event when inferred"
  );

  assert.ok(
    src.includes('this.sessions.send(session, "mud_result", mudPayload);'),
    "MessageRouter must send mud_result with mudPayload (text + optional event)"
  );
});
