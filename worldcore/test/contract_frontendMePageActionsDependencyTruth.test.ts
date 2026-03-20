//worldcore/test/contract_frontendMePageActionsDependencyTruth.test.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function resolveRepoRoot() {
  const cwd = process.cwd();
  const candidates = [
    cwd,
    path.resolve(__dirname, '..', '..'),
    path.resolve(__dirname, '..', '..', '..'),
    path.resolve(__dirname, '..', '..', '..', '..'),
  ];
  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, 'web-frontend', 'WebFrontendRegistry.json')) &&
      fs.existsSync(path.join(candidate, 'web-frontend', 'components', 'city', 'createMePageActions.ts'))
    ) {
      return candidate;
    }
  }
  throw new Error('Unable to resolve repo root for frontend MePage actions dependency truth contract');
}

test('[contract] MePage actions helper direct and delegated API usage declares backend route dependencies', () => {
  const repoRoot = resolveRepoRoot();
  const registryPath = path.join(repoRoot, 'web-frontend', 'WebFrontendRegistry.json');
  const helperPath = path.join(repoRoot, 'web-frontend', 'components', 'city', 'createMePageActions.ts');

  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const services = registry?.services ?? {};
  const entry = services['web-frontend.components.city.mePageActions'];
  assert.ok(entry, 'WebFrontendRegistry should contain web-frontend.components.city.mePageActions');
  assert.equal(
    entry.path,
    'web-frontend/components/city/createMePageActions.ts',
    'mePageActions registry entry should point at createMePageActions.ts'
  );

  const source = fs.readFileSync(helperPath, 'utf8');

  const directFamilies = [
    '/api/buildings',
    '/api/city',
    '/api/armies',
    '/api/heroes',
    '/api/workshop',
    '/api/policies',
  ];

  for (const family of directFamilies) {
    assert.ok(
      source.includes(family),
      `createMePageActions.ts should still contain direct literal usage for ${family}`
    );
  }

  const delegatedHelpers: Array<[string, string]> = [
    ['bootstrapCity', 'web-backend.routes.city'],
    ['renameCity', 'web-backend.routes.city'],
    ['startTech', 'web-backend.routes.tech'],
    ['startMission', 'web-backend.routes.missions'],
    ['completeMission', 'web-backend.routes.missions'],
    ['executeWorldConsequenceAction', 'web-backend.routes.worldConsequences'],
  ];

  for (const [helperName] of delegatedHelpers) {
    assert.match(
      source,
      new RegExp(`\\b${helperName}\\b`),
      `createMePageActions.ts should still delegate through ${helperName}`
    );
  }

  const dependsOn = new Set<string>(entry.dependsOn ?? []);
  const expectedDeps = new Set<string>([
    'web-backend.routes.buildings',
    'web-backend.routes.city',
    'web-backend.routes.armies',
    'web-backend.routes.heroes',
    'web-backend.routes.workshop',
    'web-backend.routes.policies',
    'web-backend.routes.tech',
    'web-backend.routes.missions',
    'web-backend.routes.worldConsequences',
  ]);

  for (const dep of expectedDeps) {
    assert.ok(
      dependsOn.has(dep),
      `Frontend registry service web-frontend.components.city.mePageActions should depend on ${dep}`
    );
  }
});
