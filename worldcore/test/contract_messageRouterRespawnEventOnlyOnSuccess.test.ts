import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function extractInferFn(src: string): string {
  const start = src.indexOf("export function inferMudResultEvent");
  assert.ok(start >= 0, "MessageRouter.ts must export inferMudResultEvent(...)");
  const tail = src.slice(start);
  const endMarker = "return undefined;";
  const endIdx = tail.indexOf(endMarker);
  assert.ok(endIdx >= 0, "inferMudResultEvent must contain 'return undefined;'");
  const after = tail.slice(endIdx + endMarker.length);
  const closeBraceIdx = after.indexOf("}");
  assert.ok(closeBraceIdx >= 0, "inferMudResultEvent must close with a '}'");
  return tail.slice(0, endIdx + endMarker.length + closeBraceIdx + 1);
}

test("[contract] respawn event is only emitted when respawn succeeds", () => {
  const p = path.resolve(process.cwd(), "core/MessageRouter.ts");
  const src = fs.readFileSync(p, "utf8");
  const fn = extractInferFn(src);

  // Must still key off verb === "respawn".
  assert.ok(fn.includes('verb === "respawn"'), 'inferMudResultEvent must check verb === "respawn"');

  // Must guard against invalid respawn attempts (e.g., not dead).
  assert.ok(
    fn.includes('startsWith("You are not dead")'),
    'inferMudResultEvent must NOT emit respawn event when reply starts with "You are not dead"'
  );

  // Secondary guard for future failure strings.
  assert.ok(
    fn.includes('startsWith("You cannot respawn")'),
    'inferMudResultEvent must NOT emit respawn event when reply starts with "You cannot respawn"'
  );
});
