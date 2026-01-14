import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function extractInferFn(src: string): string {
  const start = src.indexOf("export function inferMudResultEvent");
  assert.ok(start >= 0, "MessageRouter.ts must export inferMudResultEvent(...)");

  // Keep checks scoped to the helper, not the whole file.
  const tail = src.slice(start);
  const endMarker = "return undefined;";
  const endIdx = tail.indexOf(endMarker);
  assert.ok(endIdx >= 0, "inferMudResultEvent must contain 'return undefined;'");

  const after = tail.slice(endIdx + endMarker.length);
  const closeBraceIdx = after.indexOf("}");
  assert.ok(closeBraceIdx >= 0, "inferMudResultEvent must close with a '}'");

  return tail.slice(0, endIdx + endMarker.length + closeBraceIdx + 1);
}

test("[contract] mud_result event inference stays strict (no broad 'die' matching)", () => {
  const p = path.resolve(process.cwd(), "core/MessageRouter.ts");
  const src = fs.readFileSync(p, "utf8");

  const fn = extractInferFn(src);

  // Allowed: canonical marker and the strict dot-suffix fallback.
  assert.ok(
    fn.includes('txt.includes("You die.")'),
    'inferMudResultEvent must check the canonical marker: txt.includes("You die.")'
  );
  assert.ok(
    fn.includes("\\bdie\\.") || fn.includes("die\\."),
    "inferMudResultEvent must use a strict die-dot matcher (\\bdie\\.) in its fallback"
  );

  // Forbidden: overly broad substring matches that would fire on random flavor text.
  const forbidden = [
    'includes("die")',
    "includes('die')",
    'includes("respawn")',
    "includes('respawn')",
    "\\bdie\\b",
    "\\brespawn\\b",
  ];

  for (const pat of forbidden) {
    assert.ok(!fn.includes(pat), `inferMudResultEvent must not include broad matcher '${pat}'`);
  }

  // Respawn must be inferred from command verb equality only.
  assert.ok(
    fn.includes('verb === "respawn"'),
    'inferMudResultEvent must infer respawn only via verb === "respawn"'
  );
});
