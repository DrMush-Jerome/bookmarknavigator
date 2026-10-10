'use strict';
// 许可文本随源码保存，构建时离线生成资源清单。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),SOURCE=path.join(ROOT,'src'),DEST=path.join(SOURCE,'licenses');
const VERSION=require('../package.json').version;
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const FONT_INFO={
  'Outfit':{version:'1.100',copyright:'Copyright 2021 The Outfit Project Authors (https://github.com/Outfitio/Outfit-Fonts)',source:'https://github.com/Outfitio/Outfit-Fonts',license:'OFL-1.1',licenseFile:'OFL-Outfit.txt'},
  'JetBrains Mono':{version:'2.211',copyright:'Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)',source:'https://github.com/JetBrains/JetBrainsMono',license:'OFL-1.1',licenseFile:'OFL-JetBrains-Mono.txt'}
};
function standalone(title,body){
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · 书签导航台</title><style>*{box-sizing:border-box}html{color-scheme:light}body{margin:0;background:#f5f7fb;color:#26354c;font:15px/1.9 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}main{max-width:1020px;margin:30px auto;padding:32px 38px;background:#fff;border:1px solid #e1e7f0;border-radius:12px}nav{display:flex;flex-wrap:wrap;gap:20px;margin-bottom:25px;font-size:14px}a{color:#42699f;text-underline-offset:3px}h1{font-size:30px;line-height:1.4}h2{font-size:22px;margin-top:34px}h3{font-size:18px}p{margin:14px 0}code{background:#f0f3f8;padding:2px 5px;border-radius:4px;font:12px/1.7 ui-monospace,monospace;overflow-wrap:anywhere}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;border-bottom:1px solid #e1e7f0;padding:11px;vertical-align:top}th{background:#f5f7fb}td{overflow-wrap:anywhere}small{font-size:11px;color:#66748a}footer{margin-top:35px;padding-top:18px;border-top:1px solid #e1e7f0;font-size:12px;color:#66748a}@media(max-width:650px){main{margin:10px;padding:22px 18px}h1{font-size:25px}th,td{padding:8px}}@media print{body{background:#fff}main{border:0;margin:0;padding:0}nav{display:none}tr{break-inside:avoid}.table-wrap{overflow:visible}}</style></head><body><main><nav aria-label="资源文档"><a href="index.html">版权与许可</a><a href="brand-icons.html">网站图标来源</a><a href="weather-icons.html">天气图标来源</a></nav>${body}<footer>书签导航台 v${escape(VERSION)} · Copyright (c) 2026 DrMush &lt;bookmarknavigator@163.com&gt;</footer></main></body></html>\n`;
}
function buildNotices(renderers){
  const {markdownHTML,pageHTML}=renderers||require('./docs.cjs');
  fs.mkdirSync(DEST,{recursive:true});
  const licenses=['OFL-Outfit.txt','OFL-JetBrains-Mono.txt','CC-BY-4.0.txt'];
  for(const name of licenses)if(!fs.existsSync(path.join(DEST,name)))throw new Error('Missing vendored license: '+name);
  fs.copyFileSync(path.join(ROOT,'LICENSE'),path.join(DEST,'project-MIT.txt'));
  const css=fs.readFileSync(path.join(SOURCE,'fonts.css'),'utf8');
  const fonts=[...css.matchAll(/font-family:'([^']+)'.*?font-weight:([^;]+).*?base64,([^)]*)/g)].map(match=>{
    const data=Buffer.from(match[3],'base64'),info=FONT_INFO[match[1]];
    if(!info)throw new Error('Unrecorded font: '+match[1]);
    return {family:match[1],...info,weight:Number(match[2]),path:'fonts.css',format:'woff2',bytes:data.length,sha256:digest(data)};
  });
  const catalog=JSON.parse(fs.readFileSync(path.join(SOURCE,'bundled-logos-data.json'),'utf8'));
  const brands=catalog.icons.map(icon=>{
    if(!icon.sourcePage||!icon.sourceUrl)throw new Error('Missing logo provenance: '+icon.id);
    const actual=digest(fs.readFileSync(path.join(SOURCE,icon.path)));
    if(actual!==icon.sha256)throw new Error('Logo fingerprint mismatch: '+icon.id);
    return {...icon,rightsHolder:'对应网站图标的版权、商标及其他权利人',license:'NOASSERTION',rightsNotice:'本项目不授予额外的图片版权或商标许可；使用及再分发适用对应权利人的条款。'};
  });
  const weather=[...fs.readFileSync(path.join(SOURCE,'weather-icons.js'),'utf8').matchAll(/"([^"]+)": "data:image\/png;base64,([^"]+)"/g)].map(match=>{
    const data=Buffer.from(match[2],'base64');
    return {name:match[1],path:'weather-icons.js',format:'png',width:data.readUInt32BE(16),height:data.readUInt32BE(20),sha256:digest(data),copyright:'Apple Inc. and its licensors',license:'NOASSERTION',sourcePage:'https://support.apple.com/guide/iphone/learn-the-weather-icons-iph4305794fb/ios',terms:'https://www.apple.com/legal/internet-services/terms/site.html'};
  });
  const inventory={projectVersion:VERSION,schemaVersion:1,fonts,weatherIcons:weather,brandIcons:brands,
    licenseFiles:Object.fromEntries(['project-MIT.txt',...licenses].map(name=>[name,{sha256:digest(fs.readFileSync(path.join(DEST,name)))}])),
    services:[{name:'Open-Meteo',source:'https://open-meteo.com/',dataLicense:'CC-BY-4.0',licenseFile:'CC-BY-4.0.txt',terms:'https://open-meteo.com/en/terms',notice:'免费 API 仅限非商业用途；数据许可与 API 使用条款分别适用。'},{name:'GeoNames (via Open-Meteo)',source:'https://www.geonames.org/',dataLicense:'CC-BY-4.0',licenseFile:'CC-BY-4.0.txt'}],
    rightsNote:'NOASSERTION 表示本项目未将第三方图片声明为开放许可资源；来源记录不代替权利人的授权。'};
  fs.writeFileSync(path.join(DEST,'resources.json'),JSON.stringify(inventory,null,2)+'\n');
  let brandMarkdown='# 网站图标来源清单\n\n本清单与包内的 '+brands.length+' 个图标逐项对应。版权、商标及其他权利归对应权利人；来源链接记录出处，不授予额外许可。\n\n| 网站 / 包内文件 | 对应域名 | 来源页面与资源 | SHA-256 |\n| --- | --- | --- | --- |\n';
  for(const icon of brands)brandMarkdown+=`| ${icon.name} · \`${icon.path}\` | ${icon.hosts.join('、')} | [来源页面](${icon.sourcePage}) · [原始资源](${icon.sourceUrl}) | \`${icon.sha256}\` |\n`;
  fs.writeFileSync(path.join(DEST,'brand-icons.md'),brandMarkdown);
  fs.writeFileSync(path.join(DEST,'brand-icons.html'),standalone('网站图标来源清单',markdownHTML(brandMarkdown).body));
  const weatherMarkdown='# 天气图标来源清单\n\n版权：Apple Inc. 及其许可方。来源为 [Apple Support 天气图标说明](https://support.apple.com/guide/iphone/learn-the-weather-icons-iph4305794fb/ios)，适用 [Apple 版权与商标指南](https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html)及[网站内容使用条款](https://www.apple.com/legal/internet-services/terms/site.html)。本项目 MIT 许可不对这些图片另授予使用或再分发授权。\n\n图片位于 `weather-icons.js`，以 base64 数据内嵌。下表指纹对应解码后的 PNG 数据；名称是导航台用于选择天气图标的标签。\n\n| 图标名称 | PNG 尺寸 | SHA-256 |\n| --- | --- | --- |\n'+weather.map(icon=>`| ${icon.name} | ${icon.width} × ${icon.height} | \`${icon.sha256}\` |`).join('\n')+'\n';
  fs.writeFileSync(path.join(DEST,'weather-icons.md'),weatherMarkdown);
  fs.writeFileSync(path.join(DEST,'weather-icons.html'),standalone('天气图标来源清单',markdownHTML(weatherMarkdown).body));
  const notice=fs.readFileSync(path.join(ROOT,'THIRD_PARTY_NOTICES.md'),'utf8');
  const local=notice.replace(/\]\(src\/licenses\//g,'](').replace(/\]\(LICENSE\)/g,'](project-MIT.txt)').replaceAll('`src/','`');
  fs.writeFileSync(path.join(DEST,'index.md'),local);
  fs.writeFileSync(path.join(DEST,'index.html'),standalone('第三方资源版权与许可',markdownHTML(local).body));
  fs.writeFileSync(path.join(ROOT,'THIRD_PARTY_NOTICES.html'),pageHTML(notice,'THIRD_PARTY_NOTICES.html'));
}
if(require.main===module){buildNotices();console.log('Generated offline third-party notices and asset provenance.');}
module.exports={buildNotices};
