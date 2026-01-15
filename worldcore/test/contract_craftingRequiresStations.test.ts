import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function findRepoRoot(): string {
  const candidates = [
    path.resolve(__dirname, "../../.."),
    path.resolve(__dirname, "../../../.."),
  ];

  for (const root of candidates) {
    const p = path.join(root, "worldcore", "mud", "commands");
    if (fs.existsSync(p)) return root;
  }

  return candidates[0];
}

function readAt(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function mustMatch(src: string, re: RegExp, msg: string): void {
  assert.ok(re.test(src), msg);
}

test("[contract] crafting must consult recipe stationKind and enforce nearby station", () => {
  const root = findRepoRoot();
  const src = readAt(root, "worldcore/mud/commands/craftCommand.ts");

  // Must consult DB recipe station requirement.
  mustMatch(src, /stationKind/, "craftCommand must reference recipe.stationKind");

  // 'craft list' should display station requirements (current style: "(requires: ${station})").
  mustMatch(
    src,
    /requires\s*:\s*\$\{\s*station\s*\}/i,
    "craft list output should display station requirements"
  );

  // Must emit a clear near-station error.
  // The implementation may either inline 'station_<kind>' or call a helper like prettyStation(...).
  mustMatch(
    src,
    /(near|nearby)\s+a[\s\S]{0,80}(station_|prettyStation\s*\()/i,
    "craftCommand must produce a near-station error message"
  );

  // Guard-rail: gating is controlled by env (keeps early dev flexible)
  mustMatch(
    src,
    /PW_CRAFT_STATIONS_REQUIRED\s*===\s*['"]1['"]/i,
    "craftCommand must allow enabling station gating via PW_CRAFT_STATIONS_REQUIRED=1"
  );
});
