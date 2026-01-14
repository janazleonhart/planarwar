import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type Hit = { file: string; line: number; excerpt: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      // Skip build + deps + tests (tests are allowed to mention event semantics).
      if (ent.name === "node_modules" || ent.name === "dist" || ent.name === "test") continue;
      walk(p, out);
    } else {
      if (!p.endsWith(".ts")) continue;
      if (p.endsWith(".d.ts")) continue;
      out.push(p);
    }
  }
  return out;
}

function lineOf(src: string, idx: number): number {
  return src.slice(0, idx).split("\n").length;
}

function excerptAt(src: string, idx: number, span = 180): string {
  const start = Math.max(0, idx - 40);
  const end = Math.min(src.length, idx + span);
  return src.slice(start, end).replace(/\s+/g, " ").trim();
}

test("[contract] mud_result event emission is restricted to canonical modules", () => {
  const root = process.cwd(); // worldcore/
  const files = walk(root);

  // Only these modules may emit a mud_result payload that includes an `event:` key.
  // Rationale:
  // - MessageRouter is the canonical inference point for mud_result events.
  // - trainingDummyAutoAttack intentionally emits a death event for the dummy loop.
  const allow = new Set<string>([
    path.join(root, "core/MessageRouter.ts"),
    path.join(root, "mud/commands/combat/autoattack/trainingDummyAutoAttack.ts"),
  ]);

  const hits: Hit[] = [];

  // Heuristic: if a file mentions mud_result and within a short window includes `event:`,
  // it's likely directly emitting MudResultPayload.event (forbidden unless allowlisted).
  const re = /["']mud_result["'][\s\S]{0,400}?event\s*:/g;

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      if (!allow.has(f)) {
        hits.push({
          file: path.relative(root, f),
          line: lineOf(src, m.index),
          excerpt: excerptAt(src, m.index),
        });
      }
    }
  }

  if (hits.length) {
    const msg =
      "Forbidden mud_result event emission detected outside allowlist:\n\n" +
      hits.map((h) => `- ${h.file}:${h.line} :: ${h.excerpt}`).join("\n") +
      "\n\nFix:\n" +
      "- Route event inference through core/MessageRouter where possible.\n" +
      "- If a new legitimate emitter is introduced, add it to the allowlist with a clear reason.\n";
    assert.fail(msg);
  }
});
