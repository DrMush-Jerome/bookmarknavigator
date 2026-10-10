'use strict';

const child = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const run = (file, cwd = ROOT) => {
  const result = child.spawnSync(process.execPath, [file], { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
};

run(path.join(__dirname, 'check-docs.cjs'));
run(path.join(__dirname, 'check-licenses.cjs'));
run(path.join(__dirname, 'test.cjs'));
const regressionDir = path.join(ROOT, 'tests');
const regression = [
  'hub-dashboard-test.cjs',
  'hub-drag-test.cjs',
  'hub-hires-test.cjs',
  'hub-icon-sources-test.cjs',
  'hub-logo-policy-test.cjs',
  'hub-logo-fit-test.cjs',
  'hub-queue-test.cjs',
  'safari-library-test.cjs',
  'safari-sync-test.cjs',
  'safari-native-archive-test.cjs'
];
for (const file of regression) run(file, regressionDir);
console.log('PASS: dashboard, drag, icon, logo, queue and Safari regressions.');
