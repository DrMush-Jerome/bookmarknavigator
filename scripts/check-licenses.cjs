'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),SRC=path.join(ROOT,'src'),LEGAL=path.join(SRC,'licenses');
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
const read=file=>fs.readFileSync(file,'utf8');
const inventory=JSON.parse(read(path.join(LEGAL,'resources.json'))),version=require('../package.json').version;
assert.equal(inventory.projectVersion,version);
const mit=read(path.join(ROOT,'LICENSE'));
assert.match(mit,/Copyright \(c\) 2026 DrMush <bookmarknavigator@163\.com>/);
assert.equal(read(path.join(LEGAL,'project-MIT.txt')),mit);
for(const [name,record] of Object.entries(inventory.licenseFiles))assert.equal(digest(fs.readFileSync(path.join(LEGAL,name))),record.sha256,'License text fingerprint: '+name);
for(const [name,author] of [['OFL-Outfit.txt','Copyright 2021 The Outfit Project Authors'],['OFL-JetBrains-Mono.txt','Copyright 2020 The JetBrains Mono Project Authors']]){
  const text=read(path.join(LEGAL,name));assert.ok(text.includes(author));assert.match(text,/SIL OPEN FONT LICENSE Version 1\.1/);assert.ok(text.length>4000,'Incomplete OFL text');
}
assert.match(read(path.join(LEGAL,'CC-BY-4.0.txt')),/Attribution 4\.0 International/);
const fontData=[...read(path.join(SRC,'fonts.css')).matchAll(/font-family:'([^']+)'.*?font-weight:([^;]+).*?base64,([^)]*)/g)];
assert.equal(fontData.length,inventory.fonts.length);
for(const match of fontData){const record=inventory.fonts.find(font=>font.family===match[1]&&font.weight===Number(match[2]));assert.ok(record,'Missing font notice');assert.equal(record.license,'OFL-1.1');assert.equal(digest(Buffer.from(match[3],'base64')),record.sha256);assert.ok(fs.existsSync(path.join(LEGAL,record.licenseFile)));}
const catalog=JSON.parse(read(path.join(SRC,'bundled-logos-data.json'))).icons;
assert.equal(inventory.brandIcons.length,catalog.length);
assert.deepEqual(new Set(inventory.brandIcons.map(icon=>path.basename(icon.path))),new Set(fs.readdirSync(path.join(SRC,'logos')).filter(name=>!name.startsWith('.'))));
for(const original of catalog){const record=inventory.brandIcons.find(icon=>icon.id===original.id);assert.ok(record,'Missing logo source');assert.equal(record.sourceUrl,original.sourceUrl);assert.equal(record.sourcePage,original.sourcePage);assert.equal(record.sha256,digest(fs.readFileSync(path.join(SRC,record.path))));assert.equal(record.license,'NOASSERTION','Brand images must not inherit project MIT');assert.ok(record.rightsNotice);}
const weather=[...read(path.join(SRC,'weather-icons.js')).matchAll(/"([^"]+)": "data:image\/png;base64,([^"]+)"/g)];
assert.equal(weather.length,inventory.weatherIcons.length);
for(const match of weather){const record=inventory.weatherIcons.find(icon=>icon.name===match[1]),data=Buffer.from(match[2],'base64');assert.ok(record);assert.equal(record.sha256,digest(data));assert.equal(record.width,data.readUInt32BE(16));assert.equal(record.height,data.readUInt32BE(20));assert.equal(record.license,'NOASSERTION');assert.ok(record.sourcePage&&record.copyright&&record.terms);}
const app=read(path.join(SRC,'app.js')),notice=read(path.join(LEGAL,'index.html'));
assert.match(app,/href="licenses\/index\.html"/);
assert.match(notice,/<a href="https:\/\/open-meteo\.com\/"[^>]*>Open-Meteo<\/a>/);
assert.match(notice,/GeoNames/);
assert.ok(inventory.services.every(service=>service.dataLicense==='CC-BY-4.0'));
for(const file of fs.readdirSync(LEGAL).filter(name=>name.endsWith('.html'))){
  const text=read(path.join(LEGAL,file));assert.match(text,/<html lang="zh-CN">/);assert.doesNotMatch(text,/<script\b/,'Bundled legal pages must work under extension CSP');
  for(const match of text.matchAll(/href="([^"]+)"/g)){const href=match[1].replaceAll('&amp;','&');if(/^(https?:|mailto:|#)/.test(href))continue;const target=path.resolve(LEGAL,decodeURIComponent(href.split('#')[0]));assert.ok(target.startsWith(SRC+path.sep),'Legal link leaves package');assert.ok(fs.existsSync(target),file+' broken legal link: '+href);}
}
for(const browser of ['chrome','edge','firefox','safari-web-extension']){
  const dir=path.join(ROOT,'dist',browser,'licenses');
  for(const file of fs.readdirSync(LEGAL))assert.equal(digest(fs.readFileSync(path.join(dir,file))),digest(fs.readFileSync(path.join(LEGAL,file))),browser+' missing or stale notice: '+file);
}
console.log(`PASS: ${new Set(inventory.fonts.map(font=>font.family)).size} font licenses, ${inventory.brandIcons.length} brand sources, ${inventory.weatherIcons.length} weather assets, data attribution and notices in four browser packages.`);
