import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function findRepoRoot(): string {
  const candidates = [
    path.resolve(__dirname, "../../.."),     // often: <repo>/dist
    path.resolve(__dirname, "../../../.."),  // often: <repo>
  ];

  for (const root of candidates) {
    const p = path.join(root, "worldcore", "mud", "commands", "gathering");
    if (fs.existsSync(p)) return root;
  }

  // Fall back to old assumption (dist root) for error messaging.
  return candidates[0];
}

function readAt(root: string, rel: string): string {
  const full = path.join(root, rel);
  return fs.readFileSync(full, "utf8");
}

function mustMatch(src: string, re: RegExp, msg: string): void {
  assert.ok(re.test(src), msg);
}

function mustNotMatch(src: string, re: RegExp, msg: string): void {
  assert.ok(!re.test(src), msg);
}

test("[contract] gathering commands must use correct gatheringKind + resource tags", () => {
  const root = findRepoRoot();

  const mining = readAt(root, "worldcore/mud/commands/gathering/miningCommand.ts");
  mustMatch(mining, /["']mining["']/, "miningCommand must pass gatheringKind 'mining'");
  mustMatch(mining, /resource_ore/, "miningCommand must allow resource_ore");
  mustMatch(mining, /resource_mana/, "miningCommand must allow resource_mana");

  const picking = readAt(root, "worldcore/mud/commands/gathering/pickingCommand.ts");
  mustMatch(picking, /["']herbalism["']/, "pickingCommand must pass gatheringKind 'herbalism'");
  mustMatch(picking, /resource_herb/, "pickingCommand must use resource_herb");
  mustNotMatch(picking, /resource_ore/, "pickingCommand must not use resource_ore");

  const fishing = readAt(root, "worldcore/mud/commands/gathering/fishingCommand.ts");
  mustMatch(fishing, /["']fishing["']/, "fishingCommand must pass gatheringKind 'fishing'");
  mustMatch(fishing, /resource_fish/, "fishingCommand must use resource_fish");
  mustNotMatch(fishing, /resource_ore/, "fishingCommand must not use resource_ore");

  const lumbering = readAt(root, "worldcore/mud/commands/gathering/lumberingCommand.ts");
  mustMatch(lumbering, /["']logging["']/, "lumberingCommand must pass gatheringKind 'logging'");
  mustMatch(lumbering, /resource_wood/, "lumberingCommand must use resource_wood");
  mustNotMatch(lumbering, /resource_ore/, "lumberingCommand must not use resource_ore");

  const quarrying = readAt(root, "worldcore/mud/commands/gathering/quarryingCommand.ts");
  mustMatch(quarrying, /["']quarrying["']/, "quarryingCommand must pass gatheringKind 'quarrying'");
  mustMatch(quarrying, /resource_stone/, "quarryingCommand must use resource_stone");
  mustNotMatch(quarrying, /resource_ore/, "quarryingCommand must not use resource_ore");

  const farming = readAt(root, "worldcore/mud/commands/gathering/farmingCommand.ts");
  mustMatch(farming, /["']farming["']/, "farmingCommand must pass gatheringKind 'farming'");
  mustMatch(farming, /resource_grain/, "farmingCommand must use resource_grain");
  mustNotMatch(farming, /resource_ore/, "farmingCommand must not use resource_ore");
});
