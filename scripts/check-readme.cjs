'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(ROOT,'README.html'),'utf8');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
assert.match(html,/<body data-standalone-guide>/);
assert.equal([...html.matchAll(/\bdata-doc-page="/g)].length,12,'Missing embedded guide or appendix');
assert.ok(!/<script[^>]+src=|<link\b|@import|\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/i.test(html),'Guide depends on a network/file request');
for(const [,attr,url] of html.matchAll(/\b(href|src)="([^"]+)"/g)){
  assert.ok(attr==='href'?/^(?:#|https?:|mailto:)/.test(url):url.startsWith('data:image/svg+xml;base64,'),'Guide depends on a sibling file: '+url);
}
const images=new Set([...html.matchAll(/src="data:image\/svg\+xml;base64,([^"]+)"/g)].map(match=>Buffer.from(match[1],'base64').toString('utf8')));
assert.equal(images.size,11,'Standalone guide must include all public illustrations');
for(const file of fs.readdirSync(path.join(ROOT,'docs/assets')).filter(file=>file.endsWith('.svg')))assert.ok(images.has(fs.readFileSync(path.join(ROOT,'docs/assets',file),'utf8')),'Missing embedded illustration: '+file);
for(const file of ['LICENSE','src/licenses/OFL-Outfit.txt','src/licenses/OFL-JetBrains-Mono.txt','src/licenses/CC-BY-4.0.txt','src/licenses/resources.json'])assert.ok(html.includes('<pre><code>'+escape(fs.readFileSync(path.join(ROOT,file),'utf8'))+'</code></pre>'),'Embedded text differs from original: '+file);
assert.ok(!/href="[^"#]*(?:maintainer|safari-packaging)/.test(html),'Private developer material included');
assert.equal(require('./docs.cjs').deliveryIndex(),html,'Delivery reading entry must be the same standalone document');
console.log('PASS: standalone README has all 12 sections, 11 illustrations and exact full license/inventory texts, with no sibling-file or network dependencies.');
