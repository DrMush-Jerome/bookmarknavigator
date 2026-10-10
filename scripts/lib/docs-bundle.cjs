'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decode=value=>value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const BROWSERS=['chrome--edge','firefox','safari'];
const PAGES=[
  ['overview','README.md','项目介绍'],
  ['install','docs/install.md','安装教程'],
  ['usage','docs/usage.md','使用指南'],
  ['safari-sync','docs/safari-sync.md','Safari 实验同步'],
  ['notices','THIRD_PARTY_NOTICES.md','第三方资源版权与许可'],
  ['brand-icons','src/licenses/brand-icons.md','网站图标来源清单'],
  ['weather-icons','src/licenses/weather-icons.md','天气图标来源清单'],
  ['resource-inventory','src/licenses/resources.json','资源清单 JSON','text'],
  ['license-mit','LICENSE','MIT License','text'],
  ['license-ofl-outfit','src/licenses/OFL-Outfit.txt','Outfit · SIL Open Font License 1.1','text'],
  ['license-ofl-jetbrains','src/licenses/OFL-JetBrains-Mono.txt','JetBrains Mono · SIL Open Font License 1.1','text'],
  ['license-cc-by','src/licenses/CC-BY-4.0.txt','Creative Commons Attribution 4.0 International','text']
];
const EXTRA_CSS=`
.image-link{width:100%;padding:0;border:0;background:none;border-radius:12px}.doc-page{min-width:0}.doc-page>h1{margin-top:0}.catalog td{overflow-wrap:anywhere}.catalog th:first-child{width:25%}.catalog th:last-child{width:23%}.plain-document pre{white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%}.plain-document pre code{white-space:pre-wrap}.zoom-dialog{width:min(1200px,94vw);max-width:94vw;max-height:94vh;padding:16px;border:1px solid var(--line);border-radius:12px;color:var(--ink);background:white}.zoom-dialog::backdrop{background:#172337b8}.zoom-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:12px;font-size:14px}.zoom-close{flex-shrink:0;border:1px solid var(--line);background:#f5f7fb;border-radius:6px;padding:5px 12px;color:var(--ink)}.zoom-dialog img{display:block;width:100%;height:auto;max-height:calc(94vh - 100px);object-fit:contain}.breadcrumb{flex-wrap:wrap}.bundle-help{margin:0 0 25px;font-size:13px;color:var(--muted)}
@media print{.zoom-dialog{display:none!important}.doc-page[hidden]{display:none!important}.image-link{cursor:default}}
`;
const SCRIPT=`
const pages=[...document.querySelectorAll('[data-doc-page]')];
const tabs=[...document.querySelectorAll('[data-browser-tab]')];
let currentPage='overview';
function selectBrowser(id){
  if(!tabs.some(tab=>tab.dataset.browserTab===id))return;
  for(const tab of tabs){const active=tab.dataset.browserTab===id;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1}
  document.querySelectorAll('[data-browser-panel]').forEach(panel=>panel.hidden=panel.dataset.browserPanel!==id);
  document.querySelectorAll('[data-browser-link]').forEach(link=>link.hidden=link.dataset.browserLink!==id);
  document.querySelector('.browser-hint').textContent='下方显示 '+tabs.find(tab=>tab.dataset.browserTab===id).textContent+' 的安装步骤。';
}
function route(scroll=true){
  let id;try{id=decodeURIComponent(location.hash.slice(1))}catch(_){id='overview'}
  const target=document.getElementById(id)||document.getElementById('overview');
  const page=target.closest('[data-doc-page]');if(!page)return;
  currentPage=page.dataset.docPage;
  pages.forEach(item=>item.hidden=item!==page);
  document.querySelectorAll('[data-outline-for]').forEach(outline=>outline.hidden=outline.dataset.outlineFor!==currentPage);
  const parent=currentPage==='safari-sync'?'install':['overview','install','usage'].includes(currentPage)?currentPage:'overview';
  document.querySelectorAll('.primary-nav a').forEach(link=>{if(link.hash==='#'+parent)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current')});
  const panel=target.closest('[data-browser-panel]');if(panel)selectBrowser(panel.dataset.browserPanel);
  document.querySelectorAll('.toc a').forEach(link=>{if(decodeURIComponent(link.hash.slice(1))===target.id)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current')});
  document.title=page.dataset.title+' · 书签导航台';
  document.querySelector('.mobile-toc').open=false;
  if(scroll){if(target===page)window.scrollTo({top:0,behavior:'instant'});else target.scrollIntoView({behavior:'instant',block:'start'})}
}
window.addEventListener('hashchange',()=>route());
document.addEventListener('click',event=>{
  const link=event.target.closest('a[href^="#"]');if(!link)return;
  if(link.hash===location.hash){event.preventDefault();route()}
});
tabs.forEach((tab,index)=>{
  tab.addEventListener('click',()=>{const hash='#install--'+tab.dataset.browserTab;if(location.hash===hash)route();else location.hash=hash});
  tab.addEventListener('keydown',event=>{let next=index;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();tabs[next].focus();tabs[next].click()});
});
const dialog=document.querySelector('.zoom-dialog'),zoomImage=dialog.querySelector('img'),zoomTitle=dialog.querySelector('.zoom-title');
document.querySelectorAll('[data-zoom]').forEach(button=>button.addEventListener('click',()=>{
  const img=button.querySelector('img');zoomImage.src=img.src;zoomImage.alt=img.alt;zoomTitle.textContent=img.alt;dialog.showModal();
}));
dialog.querySelector('.zoom-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close()}});
dialog.addEventListener('close',()=>zoomImage.removeAttribute('src'));
document.querySelector('.print').addEventListener('click',()=>window.print());
document.querySelectorAll('.copy').forEach(button=>button.addEventListener('click',async()=>{
  const value=button.closest('.code-block').querySelector('pre').textContent;let success=false;
  try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(value);success=true}}catch(_){}
  if(!success){const box=document.createElement('textarea');box.value=value;box.style.cssText='position:fixed;opacity:0';document.body.append(box);box.select();try{success=document.execCommand('copy')}catch(_){}box.remove()}
  const status=document.querySelector('.status');status.textContent=success?'已复制':'请选中文字后手动复制';setTimeout(()=>status.textContent='',2400);
}));
if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{const visible=entries.filter(entry=>entry.isIntersecting&&!entry.target.closest('[hidden]')).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top);if(!visible.length)return;document.querySelectorAll('[data-outline-for="'+currentPage+'"] a').forEach(link=>{if(decodeURIComponent(link.hash.slice(1))===visible[0].target.id)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current')})},{rootMargin:'-130px 0px -65% 0px'});pages.forEach(page=>page.querySelectorAll('h2').forEach(heading=>observer.observe(heading)))}
route();
`;
function standaloneHTML({markdownHTML,css,version}){
  const aliases=new Map();
  for(const [id,file] of PAGES){aliases.set(file,id);aliases.set(file.replace(/\.md$/,'.html'),id)}
  aliases.set('src/licenses/project-MIT.txt','license-mit');
  aliases.set('src/licenses/index.html','notices');
  const rendered=PAGES.map(([id,file,title,format])=>{
    const source=fs.readFileSync(path.join(ROOT,file),'utf8');
    const parsed=format==='text'?{body:`<h1>${escape(title)}</h1><div class="code-block plain-document"><div class="code-label">${escape(path.basename(file))}<button class="copy" type="button">复制</button></div><pre><code>${escape(source)}</code></pre></div>`,headings:[]}:markdownHTML(source);
    const localIDs=new Set([...parsed.body.matchAll(/\bid="([^"]+)"/g)].map(match=>decode(match[1])));
    let body=parsed.body.replace(/\bid="([^"]+)"/g,(_,value)=>`id="${id}--${value}"`);
    body=body.replace(/<a class="image-link"[^>]*>(.*?)<\/a>/gs,(_,content)=>`<button class="image-link" type="button" data-zoom aria-label="放大配图">${content}</button>`);
    body=body.replace(/\b(href|src)="([^"]+)"/g,(_,attr,encoded)=>{
      const url=decode(encoded);
      if(/^(?:https?:|mailto:)/i.test(url)){
        if(attr==='src')throw new Error('Standalone guide must embed remote resources: '+url);
        return `${attr}="${encoded}"`;
      }
      const [filename,fragment]=url.split('#');
      const resolved=filename?path.posix.normalize(path.posix.join(path.posix.dirname(file),decodeURIComponent(filename))):file;
      if(attr==='src'){
        if(!/^docs\/assets\/[^/]+\.svg$/.test(resolved))throw new Error('Unsupported inline illustration: '+resolved);
        return `src="data:image/svg+xml;base64,${fs.readFileSync(path.join(ROOT,resolved)).toString('base64')}"`;
      }
      const target=aliases.get(resolved);if(!target)throw new Error('Unbundled guide link: '+file+' → '+url);
      if(!filename&&fragment&&!localIDs.has(decodeURIComponent(fragment)))throw new Error('Missing source heading: '+url);
      return `href="#${escape(target+(fragment?'--'+decodeURIComponent(fragment):''))}"`;
    });
    const headings=parsed.headings.filter(h=>h.level===2).map(h=>({...h,id:id+'--'+h.id}));
    if(id==='install'){
      body=body.split(/(?=<h2\b)/).map(part=>{
        if(!part.startsWith('<h2'))return part;
        const heading=decode(part.match(/id="([^"]+)"/)[1]);
        const browser=BROWSERS.find(b=>heading==='install--'+b);
        return `<section class="doc-section"${browser?` role="tabpanel" id="browser-panel-${browser}" aria-labelledby="browser-tab-${browser}" data-browser-panel="${browser}"${browser!==BROWSERS[0]?' hidden':''}`:''}>${part}</section>`;
      }).join('\n');
      const buttons=BROWSERS.map((browser,index)=>`<button type="button" role="tab" id="browser-tab-${browser}" aria-controls="browser-panel-${browser}" aria-selected="${index===0}" tabindex="${index===0?0:-1}" data-browser-tab="${browser}">${['Chrome / Edge','Firefox','Safari'][index]}</button>`).join('');
      body=body.replace(/(?=<section[^>]*data-browser-panel="chrome--edge")/,`<div class="browser-picker"><div class="browser-tabs" role="tablist" aria-label="浏览器安装步骤">${buttons}</div><p class="browser-hint" aria-live="polite">下方显示 Chrome / Edge 的安装步骤。</p></div>`);
    }
    const appendix=!['overview','install','usage','safari-sync'].includes(id);
    const breadcrumb=id==='safari-sync'?'<div class="breadcrumb"><a href="#install--safari">Safari 安装教程</a><span>/</span><span>实验同步</span></div>':appendix?`<div class="breadcrumb"><a href="#overview">项目介绍</a><span>/</span>${id==='notices'?'':`<a href="#notices">版权与许可</a><span>/</span>`}<span>${escape(title)}</span></div>`:'';
    if(['brand-icons','weather-icons'].includes(id))body=`<div class="catalog">${body}</div>`;
    return {id,title,headings,body:`<section class="doc-page" data-doc-page="${id}" data-title="${escape(title)}" id="${id}"${id!=='overview'?' hidden':''}>${breadcrumb}${body}</section>`};
  });
  const outlines=rendered.map(page=>{
    const items=page.headings.length?page.headings:[{id:page.id,title:page.title}];
    const links=items.map(h=>{
      const browser=page.id==='install'&&BROWSERS.find(b=>h.id==='install--'+b);
      return `<a href="#${escape(h.id)}"${browser?` data-browser-link="${browser}"${browser!==BROWSERS[0]?' hidden':''}`:''}>${escape(h.title)}</a>`;
    }).join('');
    return `<nav class="toc" data-outline-for="${page.id}"${page.id!=='overview'?' hidden':''}>${links}</nav>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="书签导航台完整图文指南：一个 HTML，离线阅读安装、使用与版权许可。"><meta name="referrer" content="no-referrer"><title>书签导航台 · 项目介绍</title><style>${css}${EXTRA_CSS}</style><noscript><style>[data-doc-page][hidden],[data-browser-panel][hidden]{display:block!important}.browser-picker,.sidebar,.mobile-toc,.print{display:none!important}.shell{display:block;max-width:850px}.doc-page+.doc-page{border-top:1px solid var(--line);margin-top:50px;padding-top:40px}</style></noscript></head><body data-standalone-guide><header class="header"><div class="header-inner"><a class="brand" href="#overview"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7v10"/></svg>书签导航台</a><nav class="primary-nav" aria-label="文档"><a href="#overview" aria-current="page">项目介绍</a><a href="#install">安装教程</a><a href="#usage">使用指南</a></nav><div class="header-actions"><span>v${escape(version)}</span><button class="print" type="button" aria-label="打印或存为 PDF">打印</button></div></div></header><div class="shell"><aside class="sidebar" aria-label="本页目录"><p class="toc-title">本页目录</p>${outlines}</aside><article><p class="eyebrow">v${escape(version)} · 单文件离线文档</p><details class="mobile-toc"><summary>本页目录</summary>${outlines}</details>${rendered.map(page=>page.body).join('\n')}<footer class="footer"><div class="footer-links"><a href="#license-mit">MIT License</a><a href="#notices">第三方资源许可</a><a href="mailto:bookmarknavigator@163.com">联系作者</a></div>DrMush 开发 · 配图为操作示意，内容均为虚构示例。</footer></article></div><dialog class="zoom-dialog" aria-labelledby="zoom-title"><div class="zoom-head"><span class="zoom-title" id="zoom-title">配图</span><button type="button" class="zoom-close" aria-label="关闭放大的配图">关闭</button></div><img alt="放大的操作示意"></dialog><div class="status" role="status" aria-live="polite"></div><script>${SCRIPT}</script></body></html>\n`;
}
module.exports={standaloneHTML};
