'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {optimizeBatch}=require('./../src/hires-icons.js');
function browser(delay=5){
 const ev=()=>{const s=new Set();return {addListener:f=>s.add(f),removeListener:f=>s.delete(f),emit:(...a)=>[...s].forEach(f=>f(...a)),s}};
 const pages=new Map();let created=0,closed=0,peak=0;
 const api={permissions:{contains:async()=>true},tabs:{onUpdated:ev(),onRemoved:ev(),create:async opt=>{const p={id:++created,url:opt.url,status:'loading'};pages.set(p.id,p);peak=Math.max(peak,pages.size);setTimeout(()=>{if(pages.has(p.id)){p.status='complete';api.tabs.onUpdated.emit(p.id,{status:'complete'},p)}},delay);return p},get:async id=>{if(!pages.has(id))throw Error('gone');return pages.get(id)},remove:async id=>{pages.delete(id);closed++;api.tabs.onRemoved.emit(id)}},scripting:{executeScript:async ({target})=>{const p=pages.get(target.tabId);assert.equal(p.status,'complete','never extract from a still-loading page');return [{result:{origin:new URL(p.url).origin,links:[{rel:'icon',href:'/icon.png'}]}}]}}};
 return {api,pages,stats:()=>({created,closed,peak})};
}
test('71 queued slow pages get independent budgets and never exceed two active tabs',async()=>{
 const b=browser(8),progress=[],sites=Array.from({length:71},(_,i)=>`https://site${i}.com`);
 const r=await optimizeBatch(sites,true,b.api,{fetchIcon:async()=> 'png',save:async()=>{}},new AbortController().signal,{timeout:200,loadTimeout:150,onProgress:p=>progress.push(p)});
 assert.equal(r.results.filter(x=>x.state==='success').length,71);
 assert.deepEqual(b.stats(),{created:71,closed:71,peak:2});
 assert.ok(progress.some(p=>p.pending>0));assert.equal(progress.at(-1).completed,71);assert.equal(progress.at(-1).pending,0);
 assert.equal(b.api.tabs.onUpdated.s.size,0);assert.equal(b.api.tabs.onRemoved.s.size,0);
});
test('late icon metadata is retried after load before download',async()=>{
 const b=browser();let calls=0,downloaded=false;
 b.api.scripting.executeScript=async()=>[{result:{origin:'https://one.com',links:++calls<3?[]:[{rel:'apple-touch-icon',href:'/large.png'}]}}];
 const r=await optimizeBatch(['https://one.com'],true,b.api,{fetchIcon:async(_,s,links)=>{assert.equal(links[0].href,'/large.png');downloaded=true;return 'png'},save:async()=>{}},new AbortController().signal,{metadataDelay:5,timeout:200});
 assert.equal(calls,3);assert.equal(downloaded,true);assert.equal(r.results[0].state,'success');assert.equal(b.stats().closed,1);
});
test('cancel keeps queued pages unopened and closes in-flight tabs',async()=>{
 const b=browser(50),c=new AbortController();
 const p=optimizeBatch(Array.from({length:20},(_,i)=>`https://site${i}.com`),true,b.api,{fetchIcon:async()=> 'png',save:async()=>{}},c.signal);
 setTimeout(()=>c.abort(),5);const r=await p;
 assert.deepEqual(b.stats(),{created:2,closed:2,peak:2});assert.equal(r.results.filter(x=>x.state==='skipped').length,20);
});
