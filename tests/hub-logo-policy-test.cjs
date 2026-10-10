'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const policy=require('./../src/logo-policy.js');
const site='data:image/png;base64,c2l0ZQ==',custom='data:image/png;base64,Y3VzdG9t';
const item={id:'one',url:'https://github.com/a'};
const catalog={'github.com':'logos/github.png','gemini.google.com':'logos/gemini.svg'};
test('exact host, protocol and safe local path only',()=>{
 assert.equal(policy.bundledPath(item.url,catalog),'logos/github.png');
 for(const url of ['https://github.com.evil.com','https://evilgithub.com','https://pages.github.com','ftp://github.com','blob:https://github.com/abc'])assert.equal(policy.bundledPath(url,catalog),'');
 assert.equal(policy.bundledPath('https://google.com',catalog),'');
 assert.equal(policy.bundledPath('https://gemini.google.com',catalog),'logos/gemini.svg');
 for(const path of ['../x.png','https://evil.com/a.png','logos/../x.png'])assert.equal(policy.bundledPath(item.url,{'github.com':path}),'');
});
test('custom > acquired > bundle > initial; never a network URL',()=>{
 const cfg={customLogos:{one:custom},siteLogos:{'https://github.com':site}};
 assert.deepEqual(policy.candidates(item,cfg,catalog),[custom,site,'logos/github.png']);
 delete cfg.customLogos.one;assert.deepEqual(policy.candidates(item,cfg,catalog),[site,'logos/github.png']);
 delete cfg.siteLogos['https://github.com'];assert.deepEqual(policy.candidates(item,cfg,catalog),['logos/github.png']);
 assert.deepEqual(policy.candidates({id:'x',url:'https://unknown.example.com'},cfg,catalog),[]);
 cfg.customLogos.one='https://external.example.com/icon.png';cfg.siteLogos['https://github.com']='data:image/svg+xml;base64,AAAA';
 assert.deepEqual(policy.candidates(item,cfg,catalog),['logos/github.png']);
 cfg.siteLogos['https://github.com']=site;assert.deepEqual(policy.candidates({id:'none',url:'blob:https://github.com/abc'},cfg,catalog),[]);
});
test('quality floor and decode bounds',()=>{
 for(const [w,h] of [[16,16],[32,32],[95,256],[256,95],[8193,96],[5000,5000],[NaN,128]])assert.equal(policy.validSize(w,h),false);
 for(const [w,h] of [[96,96],[128,128],[256,256],[512,256]])assert.equal(policy.validSize(w,h),true);
});
const source=fs.readFileSync('../src/app.js','utf8');
function bindFixture(){
 const listeners={},image={src:custom,complete:false,naturalWidth:0,naturalHeight:0,style:{visibility:'hidden'},addEventListener:(name,fn)=>listeners[name]=fn};
 const icon={dataset:{c:'#777',i:'G'},style:{removeProperty(){}}};
 const card={dataset:{itemId:'one'},querySelector:s=>s==='.ico'?icon:image};
 const ctx=vm.createContext({CATS:[{items:[item]}],CFG:{customLogos:{one:custom},siteLogos:{'https://github.com':site}},HubLogos:{...policy,candidates:(item,cfg)=>policy.candidates(item,cfg,catalog)},contentEl:{querySelectorAll:()=>[card]},applyLogoBacking:()=>{icon.dataset.logoTone='light'}});
 vm.runInContext(source.slice(source.indexOf('function bindCardRefs'),source.indexOf('function catOf')),ctx);vm.runInContext('bindCardRefs()',ctx);
 return {image,icon,listeners};
}
test('runtime low image and failed cache advance to bundled image without exposing low pixels',()=>{
 const {image,icon,listeners}=bindFixture();image.naturalWidth=image.naturalHeight=32;listeners.load();assert.equal(image.src,site);assert.equal(image.style.visibility,'hidden');
 listeners.error();assert.equal(image.src,'logos/github.png');image.naturalWidth=image.naturalHeight=256;listeners.load();assert.equal(image.style.visibility,'visible');assert.equal(icon.dataset.logoTone,'light');
});
test('all failed candidates leave plain first character',()=>{
 const {image,icon,listeners}=bindFixture();listeners.error();listeners.error();listeners.error();assert.equal(icon.textContent,'G');assert.equal(icon.style.background,'#777');assert.equal(image.style.visibility,'hidden');
});
test('both image entry points start hidden; no Chrome favicon fallback remains',()=>{
 assert.equal((source.match(/style="visibility:hidden"/g)||[]).length,2);assert.doesNotMatch(source,/_favicon|faviconUrl|FAVICON_API/);
 const manifest=JSON.parse(fs.readFileSync('../src/manifest.json'));assert.ok(!manifest.permissions.includes('favicon'));
});
