'use strict';
// 项目文档使用的 Markdown 语法解析器。
const fs = require('node:fs'), path = require('node:path');
const ROOT = path.resolve(__dirname,'..');
const {makeIllustrations}=require('./docs-illustrations.cjs');
const version = () => JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).version;
const escape = text => String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slug = text => text.toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu,'').replace(/ /g,'-');
const safeURL = url => /^(?:https?:|mailto:|#|\.?\.?\/|[\w\p{L}])/u.test(url) && !/^(?:javascript|data|file):/i.test(url);
const htmlLink = url => url.replace(/\.md(?=#|$)/,'.html');
function inline(markdown) {
  const tokens=[];
  const keep=value=>'\0'+(tokens.push(value)-1)+'\0';
  let content=markdown.replace(/`([^`]+)`/g,(_,code)=>keep('<code>'+escape(code)+'</code>'));
  content=content.replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g,(_,alt,url)=>{
    let dimensions='';
    if(/\.svg$/.test(url))for(const directory of ['docs/assets','developer/assets']){
      const file=path.join(ROOT,directory,path.basename(url));
      if(!fs.existsSync(file))continue;
      const match=fs.readFileSync(file,'utf8').match(/width="(\d+)" height="(\d+)"/);
      if(match)dimensions=` width="${match[1]}" height="${match[2]}"`;break;
    }
    return keep(safeURL(url)?`<img src="${escape(url)}" alt="${escape(alt)}"${dimensions} loading="lazy" decoding="async">`:escape(alt));
  });
  content=content.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g,(_,label,url)=>
    keep(safeURL(url)?`<a href="${escape(htmlLink(url))}">${escape(label)}</a>`:escape(label)));
  content=escape(content).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  return content.replace(/\0(\d+)\0/g,(_,i)=>tokens[Number(i)]);
}
function markdownHTML(source) {
  const lines=source.replace(/\r/g,'').split('\n'), output=[], headings=[], seen=new Map();
  let i=0;
  while(i<lines.length) {
    const current=lines[i];
    if(!current.trim()){i++;continue;}
    if(current.startsWith('```')){
      const language=current.slice(3).trim(), code=[]; i++;
      while(i<lines.length&&!lines[i].startsWith('```'))code.push(lines[i++]);
      i++;output.push(`<div class="code-block"><div class="code-label">${escape(language||'text')}<button class="copy" type="button">复制</button></div><pre><code>${escape(code.join('\n'))}</code></pre></div>`);continue;
    }
    const heading=current.match(/^(#{1,6})\s+(.+)$/);
    if(heading){
      const level=heading[1].length, title=heading[2], base=slug(title), count=seen.get(base)||0;
      seen.set(base,count+1);const id=base+(count?'-'+count:'');
      if(level>1&&level<4)headings.push({level,title,id});
      output.push(`<h${level} id="${escape(id)}">${inline(title)}</h${level}>`);i++;continue;
    }
    if(/^\|/.test(current)&&i+1<lines.length&&/^\|\s*:?-/.test(lines[i+1])){
      const cells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(cell=>inline(cell.trim()));
      const header=cells(current), body=[];i+=2;
      while(i<lines.length&&/^\|/.test(lines[i]))body.push(cells(lines[i++]));
      output.push(`<div class="table-wrap"><table><thead><tr>${header.map(value=>'<th scope="col">'+value+'</th>').join('')}</tr></thead><tbody>${body.map(row=>'<tr>'+row.map(value=>'<td>'+value+'</td>').join('')+'</tr>').join('')}</tbody></table></div>`);continue;
    }
    if(/^>\s?/.test(current)){
      const quote=[];while(i<lines.length&&/^>\s?/.test(lines[i]))quote.push(lines[i++].replace(/^>\s?/,''));
      output.push(`<aside class="note">${inline(quote.join(' '))}</aside>`);continue;
    }
    const item=current.match(/^(?:([-*])|(\d+)\.)\s+(.+)$/);
    if(item){
      const ordered=!!item[2], tag=ordered?'ol':'ul', items=[];
      while(i<lines.length){const match=lines[i].match(ordered?/^\d+\.\s+(.+)$/:/^[-*]\s+(.+)$/);if(!match)break;items.push(inline(match[1]));i++;}
      output.push(`<${tag}${ordered?' class="steps"':''}>${items.map(value=>'<li>'+value+'</li>').join('')}</${tag}>`);continue;
    }
    if(/^!\[/.test(current)){
      const figure=current.match(/^!\[([^\]]*)\]\(([^\s)]+)\)$/);
      output.push(figure?`<figure><a class="image-link" href="${escape(figure[2])}" target="_blank" rel="noopener" aria-label="${escape(figure[1])}，在新标签页放大">${inline(current)}</a><figcaption>操作示意 · 点击配图可放大查看</figcaption></figure>`:`<figure>${inline(current)}</figure>`);i++;continue;
    }
    const paragraph=[current];i++;
    while(i<lines.length&&lines[i].trim()&&!/^(?:#{1,6}\s|```|\||>\s|!\[|[-*]\s|\d+\.\s)/.test(lines[i]))paragraph.push(lines[i++]);
    output.push('<p>'+inline(paragraph.join(' '))+'</p>');
  }
  return {body:output.join('\n'),headings};
}
const {readerHTML,CSS}=require('./lib/docs-reader.cjs');
const {standaloneHTML}=require('./lib/docs-bundle.cjs');
function pageHTML(source,file){
  return readerHTML({parsed:markdownHTML(source),title:source.match(/^# (.+)$/m)?.[1]||'书签导航台',file,version:version()});
}
function safariMarkdown({signed=false}={}){
  const install=fs.readFileSync(path.join(ROOT,'docs/install.md'),'utf8');
  let safari=install.slice(install.indexOf('## Safari\n')+'## Safari\n'.length,install.indexOf('## 安装后检查'));
  if(signed){
    safari=safari.replace(/^> 当前为未公证的免费测试包。.*\n/m,'');
    safari=safari.replace(/### 2\. 允许未签名扩展[\s\S]*?(?=### 3\.)/,'');
    safari=safari.replace('### 3. 启用扩展和新标签页','### 2. 启用扩展和新标签页').replace('### 4. 导入 Safari 书签','### 3. 导入 Safari 书签');
  }
  return '# Safari 安装教程\n\n'+safari.trim()+'\n';
}
function safariQuickstart({signed=false,appVersion=version()}={}){
  const parsed=markdownHTML(safariMarkdown({signed}));
  parsed.body=parsed.body.replace(/<img[^>]+src="assets\/([^"/]+\.svg)"[^>]*>/g,(_,name)=>fs.readFileSync(path.join(ROOT,'docs/assets',name),'utf8'));
  parsed.body=parsed.body.replace(/href="((?!https?:|mailto:|#)[^"]+)"/g,(_,url)=>`href="使用指南/docs/${url}"`);
  return readerHTML({parsed,title:'Safari 安装教程',file:'safari-installer.html',version:appVersion,navPrefix:'使用指南/',markdownLink:'安装说明.md',tocLevel:3});
}
function buildDocs(){
  makeIllustrations();
  require('./licenses.cjs').buildNotices({markdownHTML,pageHTML});
  const documents=['README.md','docs/install.md','docs/usage.md','docs/safari-sync.md'];
  for(const file of ['developer/maintainer.md','developer/safari-packaging.md'])if(fs.existsSync(path.join(ROOT,file)))documents.push(file);
  for(const document of documents){const output=document.replace(/\.md$/,'.html');fs.writeFileSync(path.join(ROOT,output),document==='README.md'?standaloneHTML({markdownHTML,css:CSS,version:version()}):pageHTML(fs.readFileSync(path.join(ROOT,document),'utf8'),output));}
  console.log('Generated user documentation'+(documents.length>4?' and separate local maintainer guides.':'.'));
}
function deliveryIndex(){
  return fs.readFileSync(path.join(ROOT,'README.html'),'utf8');
}
function exportDeveloperDocs(destination){
  const source=path.join(ROOT,'developer');
  if(!fs.existsSync(source))return false;
  fs.mkdirSync(destination,{recursive:true});
  for(const file of ['maintainer.md','safari-packaging.md']){
    const text=fs.readFileSync(path.join(source,file),'utf8').replace(/\]\(\.\.\/docs\//g,'](../bookmarknavigator/docs/');
    fs.writeFileSync(path.join(destination,file),text);
    const parsed=markdownHTML(text);
    fs.writeFileSync(path.join(destination,file.replace('.md','.html')),readerHTML({parsed,title:text.match(/^# (.+)$/m)[1],file:'developer/'+file.replace('.md','.html'),version:version(),navPrefix:'../',licenseLink:'../bookmarknavigator/LICENSE',navItems:[['开发者资料/maintainer.html','维护与发布'],['开发者资料/safari-packaging.html','Safari 构建细节']]}));
  }
  fs.cpSync(path.join(source,'assets'),path.join(destination,'assets'),{recursive:true,filter:file=>!path.basename(file).startsWith('._')&&path.basename(file)!=='.DS_Store'});
  return true;
}
if(require.main===module)buildDocs();
module.exports={buildDocs,safariQuickstart,safariMarkdown,deliveryIndex,exportDeveloperDocs,markdownHTML,pageHTML};
