import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("[contract] MessageRouter attaches MudResultPayload.event for respawn/death", () => {
  const p = path.resolve(process.cwd(), "core/MessageRouter.ts");
  const src = fs.readFileSync(p, "utf8");

  // Ensure the helper exists (keeps logic testable + intentional).
  assert.ok(
    src.includes("export function inferMudResultEvent"),
    "MessageRouter must export inferMudResultEvent(...)"
  );

  // Ensure respawn is inferred from the command verb (stable + explicit).
  assert.ok(
    src.includes('verb === "respawn"'),
    'inferMudResultEvent must infer respawn from the command verb'
  );

  // Ensure the MUD result send path applies the inferred event.
  assert.ok(
    src.includes("const event = inferMudResultEvent(text, replyText);"),
    "MessageRouter must call inferMudResultEvent(text, replyText) in the MUD send path"
  );

  assert.ok(
    src.includes("if (event) mudPayload.event = event;"),
    "MessageRouter must attach mudPayload.event when inferred"
  );

  assert.ok(
    src.includes('this.sessions.send(session, "mud_result", mudPayload);'),
    "MessageRouter must send mudPayload (with optional event) for mud_result"
  );
});
