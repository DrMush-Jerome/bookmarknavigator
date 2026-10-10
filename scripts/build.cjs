'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const sourceManifestPath = path.join(SOURCE, 'manifest.json');
const base = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'));
require('./licenses.cjs').buildNotices();

const clone = value => JSON.parse(JSON.stringify(value));
const unique = values => [...new Set(values)];

function firefoxManifest() {
  const manifest = clone(base);
  delete manifest.minimum_chrome_version;
  delete manifest.optional_host_permissions;
  // Firefox 的主机权限放在 optional_permissions，以兼容较早的 MV3 实现。
  manifest.optional_permissions = ['scripting', 'https://*/*', 'http://*/*'];
  manifest.browser_specific_settings = {
    gecko: {
      id: 'bookmarknavigator@163.com',
      strict_min_version: '109.0'
    }
  };
  return manifest;
}

function safariManifest() {
  const manifest = clone(base);
  delete manifest.minimum_chrome_version;
  // Safari 不提供 bookmarks 和 history API。
  manifest.permissions = unique((base.permissions || []).filter(p => !['bookmarks', 'history'].includes(p)));
  manifest.permissions.push('nativeMessaging');
  return manifest;
}

const variants = {
  chrome: clone(base),
  edge: clone(base),
  firefox: firefoxManifest(),
  'safari-web-extension': safariManifest()
};

function copySource(destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(SOURCE, destination, {
    recursive: true,
    filter: entry => path.basename(entry) !== 'manifest.json'
  });
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
for (const [name, manifest] of Object.entries(variants)) {
  const destination = path.join(DIST, name);
  copySource(destination);
  fs.writeFileSync(
    path.join(destination, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  );
}

const required = ['newtab.html', 'compat.js', 'app.js', 'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png'];
for (const name of Object.keys(variants)) {
  const destination = path.join(DIST, name);
  for (const relative of required) {
    if (!fs.existsSync(path.join(destination, relative))) {
      throw new Error(`${name}: missing ${relative}`);
    }
  }
}

console.log(`Built ${Object.keys(variants).length} browser packages in ${path.relative(ROOT, DIST)}.`);
for (const [name, manifest] of Object.entries(variants)) {
  console.log(`- ${name}: Manifest V${manifest.manifest_version}, ${manifest.version}`);
}
