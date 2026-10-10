'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { zipDirectory } = require('./lib/archive.cjs');
const ROOT = path.resolve(__dirname, '..');
function checksums() {
  const dir = path.join(ROOT, 'release');
  const files = fs.readdirSync(dir).filter(f => /\.(zip|dmg)$/.test(f)||/-readme\.html$/.test(f)).sort();
  const lines = files.map(file => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex')}  ${file}`);
  fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
}
if (require.main === module) {
  require('./docs.cjs').buildDocs();
  require('./build.cjs');
  const version = require('../package.json').version, dir = path.join(ROOT, 'release');
  fs.mkdirSync(dir, { recursive: true });
  const guide=`bookmarknavigator-v${version}-readme.html`;
  fs.copyFileSync(path.join(ROOT,'README.html'),path.join(dir,guide));
  console.log(`Created release/${guide}`);
  for (const browser of ['chrome', 'edge', 'firefox', 'safari-web-extension']) {
    const name = `bookmarknavigator-v${version}-${browser}.zip`;
    zipDirectory(path.join(ROOT, 'dist', browser), path.join(dir, name));
    console.log(`Created release/${name}`);
  }
  checksums();
}
module.exports = { checksums };
