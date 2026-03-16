//web-backend/scripts/run-tests.cjs

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const testRoot = path.join(projectRoot, 'test');
const testFilePattern = /\.test\.ts$/;

function collectTestFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }
    if (entry.isFile() && testFilePattern.test(entry.name)) {
      files.push(path.relative(projectRoot, fullPath));
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

const testFiles = collectTestFiles(testRoot);

if (testFiles.length === 0) {
  console.log('[web-backend:test] No test files found under test/**/*.test.ts');
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...testFiles],
  {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  },
);

if (result.error) {
  console.error('[web-backend:test] Failed to launch Node test runner:', result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
