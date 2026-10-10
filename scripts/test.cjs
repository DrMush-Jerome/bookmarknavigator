'use strict';

const assert = require('node:assert/strict');
const child = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function filesUnder(root) {
  const out = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(root, full).replaceAll(path.sep, '/'));
    }
  }
  walk(root);
  return out.sort();
}

function checkSyntax(file) {
  child.execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

const sourceFiles = filesUnder(SOURCE);
const packageJson = readJson(path.join(ROOT, 'package.json'));
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
assert.equal(packageJson.name, 'bookmarknavigator');
assert.equal(packageJson.author.name, 'DrMush');
assert.equal(packageJson.author.email, 'bookmarknavigator@163.com');
assert.match(readme, /^# 书签导航台/m);
assert.match(readme, /bookmarknavigator/);
assert.match(readme, /DrMush/);
assert.match(readme, /bookmarknavigator@163\.com/);
for (const relative of sourceFiles.filter(file => file.endsWith('.js'))) {
  checkSyntax(path.join(SOURCE, relative));
}
checkSyntax(path.join(ROOT, 'scripts', 'build.cjs'));
checkSyntax(path.join(ROOT, 'scripts', 'preview.cjs'));

const html = fs.readFileSync(path.join(SOURCE, 'newtab.html'), 'utf8');
assert.ok(html.indexOf('src="compat.js"') < html.indexOf('src="app.js"'), 'compat bridge must load before app.js');
assert.equal((html.match(/\bid="([^"]+)"/g) || []).length,
  new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])).size,
  'newtab.html contains duplicate ids');

const app = fs.readFileSync(path.join(SOURCE, 'app.js'), 'utf8');
const organize = fs.readFileSync(path.join(SOURCE, 'organize.js'), 'utf8');
const drag = fs.readFileSync(path.join(SOURCE, 'drag.js'), 'utf8');
const hires = fs.readFileSync(path.join(SOURCE, 'hires-icons.js'), 'utf8');
assert.match(app, /const HUB_API = globalThis\.HUB_API/);
assert.doesNotMatch(app, /\bchrome\.(bookmarks|storage|permissions|history|runtime)\b/);
assert.doesNotMatch(organize, /\bchrome\.bookmarks\b/);
assert.doesNotMatch(drag, /\bchrome\.bookmarks\b/);
assert.doesNotMatch(hires, /\bchrome\.(permissions|tabs|scripting|storage|runtime)\b/);
assert.match(app, /chrome:\/\/settings\/onStartup/);
assert.match(hires, /data-group-all="retry"/);
assert.match(hires, /data-fold="pending" open/);
assert.match(hires, /data-fold="done"><summary/);
assert.match(drag, /const cat = realCat\(nav\.dataset\.key\);/);
assert.match(drag, /CFG\.sortBy = 'custom'; saveCfg\(\);/);

const { moveIndex, reorderFavorites } = require(path.join(SOURCE, 'drag.js'));
assert.equal(moveIndex([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'a', 'b', true), 2);
assert.equal(moveIndex([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'c', 'b', true), null);
assert.deepEqual(reorderFavorites(['a', 'b', 'c'], 'a', null, false), ['b', 'c', 'a']);
assert.throws(() => reorderFavorites(['a'], 'missing', 'a', false));

const { publicOrigin, rasterSize, candidates } = require(path.join(SOURCE, 'hires-icons.js'));
assert.equal(publicOrigin('https://www.example.com/path'), 'https://www.example.com');
assert.equal(publicOrigin('http://localhost/path'), null);
assert.equal(publicOrigin('https://example.com:8443/path'), null);
assert.deepEqual(rasterSize(512, 256), { edge: 256, width: 256, height: 128 });
assert.equal(rasterSize(32, 32), null);
assert.ok(candidates('https://example.com', [{ rel: 'icon', href: 'https://example.com/icon.png', sizes: '512x512' }])[0].endsWith('/icon.png'));

const variantNames = ['chrome', 'edge', 'firefox', 'safari-web-extension'];
const sourceSet = new Set(sourceFiles);
for (const name of variantNames) {
  const dir = path.join(DIST, name);
  assert.ok(fs.existsSync(dir), `missing build output: ${name}; run npm run build first`);
  const manifest = readJson(path.join(dir, 'manifest.json'));
  assert.deepEqual(new Set(filesUnder(dir)), sourceSet, `${name} file set differs from src`);
  assert.deepEqual(manifest.chrome_url_overrides, { newtab: 'newtab.html' });
  assert.ok(fs.existsSync(path.join(dir, 'icons', 'icon128.png')));
}
const chrome = readJson(path.join(DIST, 'chrome', 'manifest.json'));
const edge = readJson(path.join(DIST, 'edge', 'manifest.json'));
const firefox = readJson(path.join(DIST, 'firefox', 'manifest.json'));
const safari = readJson(path.join(DIST, 'safari-web-extension', 'manifest.json'));
assert.equal(chrome.manifest_version, 3);
assert.equal(chrome.name, '书签导航台');
assert.match(chrome.description, /DrMush/);
assert.equal(edge.manifest_version, 3);
assert.deepEqual(chrome.optional_host_permissions, ['https://*/*', 'http://*/*']);
assert.deepEqual(edge.optional_permissions, ['scripting']);
assert.equal(firefox.manifest_version, 3);
assert.ok(firefox.optional_permissions.includes('https://*/*'));
assert.equal(firefox.browser_specific_settings.gecko.strict_min_version, '109.0');
assert.equal(safari.manifest_version, 3);
assert.deepEqual(safari.permissions, ['storage', 'nativeMessaging']);
assert.ok(safari.host_permissions.includes('https://api.open-meteo.com/*'));
assert.deepEqual(safari.optional_permissions, ['scripting']);
assert.deepEqual(safari.optional_host_permissions, ['https://*/*', 'http://*/*']);
assert.ok(html.indexOf('src="local-bookmarks.js"') < html.indexOf('src="compat.js"'));

console.log('PASS: source syntax, API bridge, UI invariants, pure drag/logo logic, and all four package manifests.');
