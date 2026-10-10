'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
const documents=['README.html','THIRD_PARTY_NOTICES.html',...fs.readdirSync(path.join(ROOT,'docs')).filter(file=>file.endsWith('.html')).map(file=>'docs/'+file)];
if(fs.existsSync(path.join(ROOT,'developer')))documents.push(...fs.readdirSync(path.join(ROOT,'developer')).filter(file=>file.endsWith('.html')).map(file=>'developer/'+file));
let checked=0;
for(const document of documents){
  const source=fs.readFileSync(path.join(ROOT,document),'utf8');
  assert.match(source,/<html lang="zh-CN">/,document+' missing language');
  assert.match(source,/name="viewport"/,document+' missing mobile viewport');
  assert.ok(!source.includes('{{VERSION}}'),document+' has unrendered placeholders');
  const developer=document.startsWith('developer/');
  const nav=source.match(/<nav class="primary-nav"[^>]*>(.*?)<\/nav>/s)?.[1];
  assert.ok(nav,document+' missing document navigation');
  assert.equal([...nav.matchAll(/<a\b/g)].length,developer?2:3,document+' mixes navigation for different readers');
  const sidebar=source.match(/<aside class="sidebar"[^>]*>(.*?)<\/aside>/s)?.[1];
  assert.ok(sidebar,document+' missing page outline');
  for(const href of sidebar.matchAll(/href="([^"]+)"/g))assert.ok(href[1].startsWith('#'),document+' sidebar links to another document');
  if(!developer)assert.ok(!/href="[^"]*(?:maintainer|safari-packaging)/.test(source),document+' exposes maintainer links in user guide');
  const ids=[...source.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(new Set(ids).size,ids.length,document+' contains duplicate IDs');
  for(const match of source.matchAll(/\b(href|src)="([^"]+)"/g)){
    const url=match[2].replace(/&amp;/g,'&');
    if(/^(?:https?:|mailto:)/.test(url))continue;
    if(document==='README.html'&&match[1]==='src'&&/^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(url)){
      const svg=Buffer.from(url.split(',')[1],'base64').toString('utf8');
      assert.ok(diagramSources().includes(svg),'Standalone guide embeds an unknown illustration');
      checked++;continue;
    }
    assert.ok(!/^[a-z]+:/i.test(url),'Unsupported document URL: '+url);
    const [pathname,fragment]=url.split('#');
    const file=pathname?path.resolve(path.dirname(path.join(ROOT,document)),decodeURIComponent(pathname)):path.join(ROOT,document);
    assert.ok(file.startsWith(ROOT+path.sep),'Document link leaves repository: '+url);
    assert.ok(fs.existsSync(file),document+' broken link: '+url);
    if(fragment&&file.endsWith('.html')){
      const target=fs.readFileSync(file,'utf8');
      const anchors=[...target.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
      assert.ok(anchors.includes(decodeURIComponent(fragment)),document+' missing anchor: '+url);
    }
    if(match[1]==='src')assert.ok(/alt="[^"]+"/.test(source.slice(match.index-5,source.indexOf('>',match.index)+1)),document+' image missing alternative text');
    checked++;
  }
}
function diagramSources(){return fs.readdirSync(path.join(ROOT,'docs/assets')).filter(file=>file.endsWith('.svg')).map(file=>fs.readFileSync(path.join(ROOT,'docs/assets',file),'utf8'))}
const assets=fs.readdirSync(path.join(ROOT,'docs/assets')).filter(file=>file.endsWith('.svg'));
for(const obsolete of ['safari-install.md','safari-install.html','safari-quickstart.html'])assert.ok(!fs.existsSync(path.join(ROOT,'docs',obsolete)),'Duplicate installation document remains: '+obsolete);
assert.equal(assets.length,11,'User diagrams must exclude private publishing illustrations');
const diagrams=assets.map(file=>'docs/assets/'+file);
if(fs.existsSync(path.join(ROOT,'developer/assets')))diagrams.push(...fs.readdirSync(path.join(ROOT,'developer/assets')).filter(file=>file.endsWith('.svg')).map(file=>'developer/assets/'+file));
for(const asset of diagrams){const source=fs.readFileSync(path.join(ROOT,asset),'utf8');assert.match(source,/<title\b/);assert.match(source,/viewBox=/);assert.ok(!/<script|<foreignObject|href=|url\(https?:/i.test(source),'Diagram has external or executable content: '+asset)}
console.log(`PASS: ${documents.length} offline guides, ${diagrams.length} diagrams and ${checked} local links/anchors.`);
require('./check-readme.cjs');
