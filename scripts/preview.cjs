// 隔离的本地预览，使用模拟数据与 API。
const http=require('http'),fs=require('fs'),path=require('path');
const root=path.resolve('src');
const fixture=`
const names=['Notion 知识库与项目协作空间以及团队文档管理','GitHub','Medium','知乎','Apple','Figma','Product Hunt','Hacker News','少数派'];
const hosts=['notion.so','github.com','medium.com','zhihu.com','apple.com','figma.com','producthunt.com','news.ycombinator.com','sspai.com'];
const folders=['工作','学习','设计','开发','工具','阅读'];
const tree=[{id:'0',children:[{id:'bar',title:'书签栏',children:folders.map((title,i)=>({id:'f'+i,title,children:names.map((name,j)=>({id:i+'-'+j,title:name,url:'https://'+hosts[j],dateAdded:Date.now()-j*86400000})).filter((_,j)=>j%6===i)}))}]}];
const makeEvent=()=>{const listeners=new Set();return {addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f),emit:(...args)=>listeners.forEach(f=>f(...args))}};
const events=makeEvent(),updated=makeEvent(),removed=makeEvent(),permissionAdded=makeEvent(),permissionRemoved=makeEvent();
const grants=new Set(['https://github.com/*','https://medium.com/*','https://api.open-meteo.com/*','https://geocoding-api.open-meteo.com/*']),tabs=new Map();let nextTab=10,opened=0,closed=0;
const metrics=document.createElement('output');metrics.id='fixture-metrics';metrics.style.cssText='position:fixed;bottom:3px;left:8px;z-index:200;font:11px sans-serif;background:#fff;color:#333;padding:4px;border-radius:4px;pointer-events:none';document.body.append(metrics);
function report(){metrics.textContent='本地模拟 · 打开 '+opened+' · 关闭 '+closed+' · 剩余 '+tabs.size} report();
const testParams=new URLSearchParams(location.search),testStoreKey='hub-preview-cfg'+(new URLSearchParams(location.search).get('browser')==='safari'?'-safari':'');
let storedCfg=null;try{storedCfg=JSON.parse(sessionStorage.getItem(testStoreKey)||'null')}catch(_){ }
const testCfg=Object.assign({legalAccepted:true},storedCfg||{},{theme:testParams.get('theme')||'light'});
let localStore={cfg:testCfg};try{localStore=Object.assign(localStore,JSON.parse(sessionStorage.getItem(testStoreKey+'-data')||'{}'))}catch(_){}
localStore.cfg=testCfg;
const storageChanged=makeEvent();
if(testParams.get('legal')==='required'&&!storedCfg)testCfg.legalAccepted=false;
if(testParams.has('quality')){const c=document.createElement('canvas');c.width=c.height=32;c.getContext('2d').fillRect(0,0,32,32);const low=c.toDataURL();testCfg.siteLogos={'https://github.com':low,'https://medium.com':low};testCfg.customLogos={'0-0':'data:image/png;base64,AAAA'};}
// 模拟书签移动，覆盖读取子项、移动节点与重读书签树。
const findNode=(nodes,id)=>{for(const n of nodes){if(String(n.id)===String(id))return n;const hit=findNode(n.children||[],id);if(hit)return hit;}return null;};
const detach=(nodes,id)=>{const i=nodes.findIndex(n=>String(n.id)===String(id));if(i>=0)return nodes.splice(i,1)[0];for(const n of nodes){const got=detach(n.children||[],id);if(got)return got;}return null;};
window.chrome={
 bookmarks:{
  getTree:async()=>tree,
  getChildren:async id=>{const node=findNode(tree,id);if(!node)throw new Error("Can't find node for getChildren: "+id);return (node.children||[]).map(c=>({...c}));},
  move:async(id,{parentId,index})=>{const node=detach(tree,id);if(!node)throw new Error("Can't find node for move: "+id);const parent=findNode(tree,parentId);if(!parent)throw new Error("Can't find destination: "+parentId);parent.children=parent.children||[];const at=Math.max(0,Math.min(Number(index)||0,parent.children.length));parent.children.splice(at,0,node);events.emit(id,{parentId,index:at,node});},
  onCreated:events,onRemoved:events,onMoved:events,onChanged:events},
 history:{search:async()=>hosts.map((h,i)=>({url:'https://'+h,visitCount:20-i}))},
 storage:{onChanged:storageChanged,local:{get:async key=>key==null?JSON.parse(JSON.stringify(localStore)):Array.isArray(key)?Object.fromEntries(key.map(k=>[k,localStore[k]])):{[key]:localStore[key]},set:async data=>{if(data&&data.cfg){Object.assign(testCfg,data.cfg);try{sessionStorage.setItem(testStoreKey,JSON.stringify(testCfg))}catch(_){}}Object.assign(localStore,JSON.parse(JSON.stringify(data)));sessionStorage.setItem(testStoreKey+'-data',JSON.stringify(localStore));storageChanged.emit(Object.fromEntries(Object.entries(data).map(([key,newValue])=>[key,{newValue}])),'local');}}},
 runtime:{getManifest:()=>({version:'UI-simulation',optional_permissions:['scripting'],optional_host_permissions:['https://*/*','http://*/*']})},
 permissions:{contains:async p=>(p.origins||[]).every(o=>grants.has(o)),request:async p=>{const mode=new URLSearchParams(location.search).get('permission');if(mode==='deny')return false;if(mode==='error')throw new Error('UI模拟：This function must be called during a user gesture');(p.origins||[]).forEach(o=>grants.add(o));permissionAdded.emit(p);return true},onAdded:permissionAdded,onRemoved:permissionRemoved},
 tabs:{onUpdated:updated,onRemoved:removed,create:async props=>{const tab={id:nextTab++,url:props.url,status:'complete',active:props.active};tabs.set(tab.id,tab);opened++;report();return {...tab}},get:async id=>{if(!tabs.has(id))throw new Error('No tab with id');return {...tabs.get(id)}},remove:async id=>{if(tabs.delete(id)){closed++;removed.emit(id,{isWindowClosing:false});report()}}},
 scripting:{executeScript:async ({target})=>{const tab=tabs.get(target.tabId);if(!tab)throw new Error('No tab');const origin=new URL(tab.url).origin;let links=[{rel:'icon',href:origin+'/icon128.png',sizes:'128x128'}];if(origin==='https://github.com')links=[{rel:'icon',href:origin+'/brand.svg',type:'image/svg+xml',sizes:'any'}];if(origin==='https://medium.com')links=[{rel:'manifest',href:origin+'/app/site.webmanifest'}];if(origin==='https://apple.com')links=[{rel:'icon',href:'https://assets.example.com/brand.png',sizes:'256x256'}];return [{result:{origin,links}}]}}
};
if(testParams.get('browser')==='safari'){delete window.chrome.bookmarks;delete window.chrome.history;}
const nativeFetch=window.fetch.bind(window);
window.fetch=async(url,options)=>{
 const u=new URL(url,location.href);
 if(u.hostname.startsWith('geocoding-api.open-meteo.com')){
   const q=(u.searchParams.get('name')||'').toLowerCase();
   const all=[{name:'上海',admin1:'上海市',country:'中国',country_code:'CN',population:27000000,latitude:31.2222,longitude:121.4581},
     {name:'上海市',admin1:'上海市',country:'中国',country_code:'CN',population:24870000,latitude:31.1302,longitude:121.2137},
     {name:'Shanghai',admin1:'Shanghai',country:'China',country_code:'CN',population:27000000,latitude:31.2222,longitude:121.4581},
     {name:'Shangqiu',admin1:'Henan',country:'China',country_code:'CN',population:7600000,latitude:34.414,longitude:115.6565},
     {name:'温州',admin1:'浙江省',country:'中国',country_code:'CN',population:9800000,latitude:27.9944,longitude:120.6994},
     {name:'温州市',admin1:'浙江省',country:'中国',country_code:'CN',population:9800000,latitude:27.9944,longitude:120.6994},
     {name:'北京',admin1:'北京市',country:'中国',country_code:'CN',population:21540000,latitude:39.9042,longitude:116.4074},
     {name:'北京市',admin1:'北京市',country:'中国',country_code:'CN',population:21540000,latitude:39.9075,longitude:116.39723},
     {name:'北京市北京路街道',admin1:'四川省',country:'中国',country_code:'CN',population:40000,latitude:30.6,longitude:104.1},
     {name:'Tokyo',admin1:'Tokyo',country:'Japan',country_code:'JP',population:13960000,latitude:35.6895,longitude:139.6917}];
   return {ok:true,json:async()=>({results:all.filter(r=>!q||r.name.toLowerCase().includes(q))})};
 }
 if(u.hostname.endsWith('open-meteo.com')){
   const start=new Date(Date.now()-new Date().getTimezoneOffset()*60000);
   const time=[],temp=[],code=[],day=[],prob=[];
   for(let i=0;i<24;i++){const d=new Date(start.getTime()+i*3600000);time.push(d.toISOString().slice(0,13)+':00');temp.push(20+Math.round(Math.sin(i/4)*4));code.push(i<6?0:i<12?1:2);day.push(i<7?1:0);prob.push(i*2);}
   const dtime=[],dmax=[],dmin=[];
   for(let i=0;i<6;i++){const d=new Date(Date.now()+i*86400000);dtime.push(d.toISOString().slice(0,10));dmax.push(26-i);dmin.push(14+i);}
   return {ok:true,json:async()=>({current:{temperature_2m:24,weather_code:0,is_day:1},hourly:{time,temperature_2m:temp,weather_code:code,is_day:day,precipitation_probability:prob},daily:{time:dtime,weather_code:[0,1,2,3,61,80],temperature_2m_max:dmax,temperature_2m_min:dmin,precipitation_probability_max:[0,10,30,60,70,40]}})};
 }
 if(u.hostname==='assets.example.com'){
   if(!grants.has('https://assets.example.com/*'))throw new Error('FIXTURE: unauthorized CDN request');
   return nativeFetch('/icons/icon128.png',options);
 }
 if(hosts.includes(u.hostname)){
   if(u.pathname==='/brand.svg')return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#536d9a"/><path d="M6 12h12M12 6v12" stroke="white" stroke-width="2"/></svg>',{headers:{'content-type':'image/svg+xml'}});
   if(u.pathname==='/app/site.webmanifest')return new Response(JSON.stringify({icons:[{src:'./brand192.png',sizes:'192x192',type:'image/png'}]}),{headers:{'content-type':'application/manifest+json'}});
   if(u.hostname==='notion.so'||u.hostname==='apple.com'||(u.hostname==='medium.com'&&u.pathname!=='/app/brand192.png'))return new Response('mock failure',{status:404});
   return nativeFetch('/icons/icon128.png',options);
 }
 return nativeFetch(url,options);
};
`;
const PORT=Number(process.env.PORT||8792);
http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/logo-check'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fs.readFileSync(path.resolve('tests/fixtures/hub-logo-browser-check.html')))}
 if(u.pathname==='/svg-check'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fs.readFileSync(path.resolve('tests/fixtures/hub-svg-browser-check.html')))}
 if(u.pathname==='/safari-library-check'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fs.readFileSync(path.resolve('tests/fixtures/safari-library-browser-check.html')))}
 if(u.pathname==='/layout-check'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fs.readFileSync(path.resolve('tests/fixtures/dashboard-layout-browser-check.html')))}
 if(u.pathname==='/settings-sort-check'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fs.readFileSync(path.resolve('tests/fixtures/settings-sort-browser-check.html')))}
 if(u.pathname==='/docs-check'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fs.readFileSync(path.resolve('tests/fixtures/docs-browser-check.html')))}
 if(u.pathname==='/standalone/readme-only.html'){res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fs.readFileSync(path.resolve('README.html')))}
 if(u.pathname==='/docs/installer-preview.html'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(require('./docs.cjs').safariQuickstart().replace(/使用指南\//g,'/'))}
 if(u.pathname==='/fixture.js'){res.setHeader('Content-Type','application/javascript');return res.end(fixture)}
 if(u.pathname==='/narrow'){res.setHeader('Content-Type','text/html');return res.end('<iframe title="390px layout check" style="border:0;width:390px;height:100vh" src="/newtab.html"></iframe>')}
 const isGuide=u.pathname.startsWith('/docs/')||u.pathname.startsWith('/developer/')||u.pathname.startsWith('/src/licenses/')||['/README.html','/README.md','/LICENSE','/THIRD_PARTY_NOTICES.md','/THIRD_PARTY_NOTICES.html'].includes(u.pathname);
 const base=isGuide?path.resolve('.'):root;
 const file=path.resolve(base,'.'+u.pathname);
 if(!file.startsWith(base+path.sep)){res.writeHead(403);return res.end()}
 try{
  let data=fs.readFileSync(file);const ext=path.extname(file);
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'})[ext]||'application/octet-stream');
  if(ext==='.html')data=data.toString().replace('<script src="compat.js"></script>','<script src="/fixture.js"></script><script src="compat.js"></script>');
  res.end(data);
 }catch{res.writeHead(404);res.end()}
}).listen(PORT,'127.0.0.1',()=>console.log(`UI simulation http://127.0.0.1:${PORT}/newtab.html`));
