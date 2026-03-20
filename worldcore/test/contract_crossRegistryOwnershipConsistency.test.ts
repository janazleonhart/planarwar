//worldcore/test/contract_crossRegistryOwnershipConsistency.test.ts


import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function findRepoRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    if (
      fs.existsSync(path.join(current, "web-backend", "WebBackendRegistry.json")) &&
      fs.existsSync(path.join(current, "worldcore", "WorldCoreRegistry.json"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Could not locate repo root from ${startDir}`);
    }
    current = parent;
  }
}

function normalizeWorldcoreRef(dep: string): string[] {
  const candidates = [dep];
  if (dep.startsWith("worldcore:")) {
    candidates.push(`${dep.replace("worldcore:", "worldcore/")}.ts`);
  }
  if (dep.startsWith("worldcore.")) {
    candidates.push(`${dep.replace(/\./g, "/")}.ts`);
  }
  return candidates;
}

test("[contract] cross-registry ownership consistency for web-backend refs", () => {
  const repoRoot = findRepoRoot(__dirname);
  const webBackendRegistry = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "web-backend", "WebBackendRegistry.json"), "utf8"),
  );
  const worldCoreRegistry = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "worldcore", "WorldCoreRegistry.json"), "utf8"),
  );
  const mmoBackendRegistry = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "mmo-backend", "MmoBackendRegistry.json"), "utf8"),
  );
  const motherBrainRegistry = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "mother-brain", "MotherBrainRegistry.json"), "utf8"),
  );

  const webServices: Record<string, any> = webBackendRegistry.services ?? {};
  const worldServices: Record<string, any> = worldCoreRegistry.services ?? {};
  const mmoServices: Record<string, any> = mmoBackendRegistry.services ?? {};
  const motherEntries: Record<string, any> = motherBrainRegistry.entries ?? {};

  const exactRefs = new Set<string>([
    ...Object.keys(webServices),
    ...Object.keys(worldServices),
    ...Object.keys(mmoServices),
    ...Object.keys(motherEntries),
  ]);
  const worldcorePaths = new Set<string>(
    Object.values(worldServices)
      .map((svc: any) => svc?.path)
      .filter((value: unknown): value is string => typeof value === "string" && value.length > 0),
  );

  for (const [serviceId, svc] of Object.entries<any>(webServices)) {
    for (const dep of svc.dependsOn ?? []) {
      if (typeof dep !== "string") continue;
      if (dep.startsWith("node:") || dep.startsWith("npm:") || dep === "global.fetch") continue;

      if (dep.startsWith("web-backend.")) {
        assert.ok(
          exactRefs.has(dep),
          `${serviceId} dependsOn ${dep}, but no such web-backend registry service exists`,
        );
        continue;
      }

      if (dep.startsWith("worldcore") || dep.startsWith("auth.") || dep.startsWith("db.") || dep.startsWith("world.")) {
        const candidates = dep.startsWith("worldcore") ? normalizeWorldcoreRef(dep) : [dep];
        assert.ok(
          candidates.some((candidate) => exactRefs.has(candidate) || worldcorePaths.has(candidate)),
          `${serviceId} dependsOn ${dep}, but no matching cross-registry worldcore ownership target exists`,
        );
      }
    }
  }

  assert.ok(webServices["web-backend.gameState.cityRuntimeSnapshot"], "Expected registry entry for web-backend.gameState.cityRuntimeSnapshot");
  assert.ok(webServices["web-backend.domain.worldConsequenceHooks"], "Expected registry entry for web-backend.domain.worldConsequenceHooks");
  assert.ok(webServices["web-backend.domain.worldConsequenceActions"], "Expected registry entry for web-backend.domain.worldConsequenceActions");
  assert.ok(webServices["web-backend.domain.worldConsequenceConsumers"], "Expected registry entry for web-backend.domain.worldConsequenceConsumers");
  assert.ok(webServices["web-backend.domain.worldConsequenceRuntimeActions"], "Expected registry entry for web-backend.domain.worldConsequenceRuntimeActions");
  assert.ok(webServices["web-backend.domain.worldConsequences"], "Expected registry entry for web-backend.domain.worldConsequences");
  assert.ok(webServices["web-backend.domain.economyCartelResponse"], "Expected registry entry for web-backend.domain.economyCartelResponse");

  assert.deepEqual(
    webServices["web-backend.gameState.gameStateCore"].dependsOn,
    [
      "web-backend.config.demo",
      "web-backend.domain.world",
      "web-backend.domain.city",
      "web-backend.domain.heroes",
      "web-backend.domain.armies",
      "web-backend.gameState",
    ],
    "gameStateCore should depend on the real config service id, not the stale web-backend.config alias",
  );
});
