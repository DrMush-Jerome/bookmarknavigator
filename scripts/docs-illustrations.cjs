'use strict';
// 文档操作示意，示例数据为虚构内容。
const fs = require('node:fs'), path = require('node:path');
const OUT = path.resolve(__dirname, '../docs/assets');
const C = { ink:'#24344b', muted:'#68758a', blue:'#4c72aa', pale:'#edf3ff', bg:'#f0f3f8', line:'#dbe3ee', orange:'#b55d31', white:'#ffffff' };
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
const rect = (x,y,w,h,fill=C.white,r=12,stroke=C.line) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"/>`;
const text = (x,y,value,size=20,color=C.ink,weight=400) => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}">${escape(value)}</text>`;
const line = (x1,y1,x2,y2,color=C.line,width=2) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${color}" stroke-width="${width}" fill="none"/>`;
const badge = (x,y,n) => `<circle cx="${x}" cy="${y}" r="17" fill="${C.blue}"/>${text(x,y+6,n,18,'#fff',700).replace('<text ', '<text text-anchor="middle" ')}`;
const button = (x,y,w,label,filled=true) => rect(x,y,w,42,filled?C.blue:C.white,8,filled?C.blue:C.line)+text(x+14,y+27,label,18,filled?'#fff':C.ink,600);
const check = (x,y,label,on=true,size=19) => rect(x,y,22,22,on?C.blue:C.white,5,on?C.blue:C.line)+(on?`<path d="M${x+5} ${y+11}l4 4 8-9" fill="none" stroke="#fff" stroke-width="2.5"/>`:'')+text(x+34,y+18,label,size);
const toggle = (x,y) => rect(x,y,44,24,C.blue,12,C.blue)+`<circle cx="${x+31}" cy="${y+12}" r="9" fill="#fff"/>`;
const arrow = (x1,y1,x2,y2,color=C.blue) => line(x1,y1,x2,y2,color,3)+`<path d="M${x2-10} ${y2-7}L${x2} ${y2}L${x2-10} ${y2+7}" stroke="${color}" fill="none" stroke-width="3"/>`;
function windowBox(x,y,w,h,title) {
  return rect(x,y,w,h)+rect(x,y,w,46,'#f8faff',12)+line(x,y+46,x+w,y+46)+
    [0,1,2].map((n)=>`<circle cx="${x+21+n*20}" cy="${y+23}" r="5" fill="${['#e5a2a1','#e3cc8d','#a8cbb6'][n]}"/>`).join('')+text(x+91,y+30,title,18,C.muted,500);
}
function svg(name,h,title,content) {
  const privateAsset=['repository','github-publish'].includes(name);
  if(privateAsset&&!fs.existsSync(path.resolve(__dirname,'../developer/maintainer.md')))return;
  const output=privateAsset?path.resolve(__dirname,'../developer/assets'):OUT;
  fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,name+'.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="${h}" viewBox="0 0 1120 ${h}" role="img" aria-labelledby="${name}-title ${name}-desc"><title id="${name}-title">${escape(title)}</title><desc id="${name}-desc">中文操作示意图，使用虚构内容，实际控件位置以浏览器为准。</desc><style>text{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif}</style>${rect(0,0,1120,h,C.bg,18,C.bg)}${content}</svg>\n`);
}
function makeIllustrations() {
  fs.mkdirSync(OUT,{recursive:true});
  let s=windowBox(24,22,1072,578,'书签导航台 · 首页布局示意');
  s+=rect(24,68,196,532,'#f9fbfe',0)+line(220,68,220,600)+text(49,111,'书签导航台',23,C.ink,700);
  ['主页','全部书签','最近添加','最常访问','工作','学习','设计'].forEach((label,i)=>{
    if(i===0)s+=rect(40,139,165,38,C.pale,9,C.pale);
    s+=text(55,165+i*48,label,18,i===0?C.blue:C.muted,i===0?600:400);
  });
  s+=text(250,111,'开始今天的浏览',29,C.ink,700)+text(251,141,'书签与常用网站，井然有序。',17,C.muted);
  s+=rect(840,86,169,40,'#f8faff',12)+text(858,112,'☀  24° 北京',18)+rect(1021,86,48,40,'#f8faff',12)+text(1033,112,'⚙',23);
  s+=rect(250,166,820,47,'#fff',13)+text(269,195,'⌕  搜索书签',18,C.muted)+text(993,195,'⌘ K',15,C.muted);
  s+=text(250,245,'常用书签',20,C.ink,650);
  ['Notion','GitHub','Figma','MDN','阅读','文档'].forEach((label,i)=>{
    const x=250+i*138;s+=rect(x,264,127,111,'#fff',15)+rect(x+41,282,44,44,['#eef0f4','#edf1f6','#fff1e6','#e8f3ef','#f4edf8','#eaf1ff'][i],10)+text(x+54,311,['N','G','F','M','阅','文'][i],24,C.blue,600)+text(x+19,354,label,17);
  });
  for(const [i,title] of ['最近添加','分类','待办事项'].entries())s+=rect(250+i*279,394,262,179,'#fff',15)+text(269+i*279,424,title,20,C.ink,650);
  ['技术文档','项目资料','设计参考'].forEach((label,i)=>s+=text(270,455+i*37,label,17,C.muted));
  ['工作','学习','设计','工具'].forEach((label,i)=>{const x=545+(i%2)*118,y=445+Math.floor(i/2)*55;s+=rect(x,y,104,43,C.pale,8,C.pale)+text(x+22,y+28,label,17,C.blue)});
  s+=text(827,455,'2026 年 10 月',17,C.muted)+text(827,490,'日  一  二  三  四  五  六',14,C.muted)+text(827,525,'4   5   6   7   8   9  10',14)+rect(826,540,226,20,C.pale,5,C.pale);
  s+=badge(242,189,1)+badge(202,308,2)+badge(1076,95,3)+badge(1050,419,4);
  s+=text(40,630,'1 搜索书签    2 切换分类    3 打开设置    4 查看与添加待办',18,C.muted);
  svg('overview',655,'认识书签导航台首页',s);

  s=windowBox(32,26,1056,484,'GitHub · 书签导航台 · Releases');
  s+=text(62,110,'Releases',27,C.ink,700)+rect(60,131,156,39,C.pale,8,C.pale)+text(74,157,'v1.13.2',21,C.blue,650)+badge(237,151,1);
  s+=text(62,209,'Assets  ▾',21,C.ink,650)+badge(189,203,2);
  const downloads=['bookmarknavigator-v1.13.2-chrome.zip','bookmarknavigator-v1.13.2-edge.zip','bookmarknavigator-v1.13.2-firefox.zip','bookmarknavigator-v1.13.2-macos-local.dmg'];
  downloads.forEach((label,i)=>{const y=230+i*47;s+=rect(60,y,650,42,i===3?C.pale:'#fff',7)+text(78,y+27,label,18,C.blue)});
  s+=text(79,450,'Source code (zip)',17,C.muted)+text(743,455,'这是源码，普通安装请选上方附件',16,C.muted);
  s+=badge(754,386,3)+text(787,381,'选与你的浏览器',20,C.ink,650)+text(787,409,'对应的安装包',20,C.ink,650);
  s+=text(47,551,'路径：仓库主页 → Releases → 对应版本 → Assets',19,C.muted);
  svg('download',574,'在 GitHub Release 下载正确安装包',s);

  s=windowBox(32,24,1056,464,'chrome://extensions  或  edge://extensions');
  s+=text(63,109,'扩展程序',27,C.ink,650)+text(840,104,'开发者模式',19)+toggle(987,84)+badge(1049,97,1);
  s+=button(62,137,257,'加载已解压的扩展程序')+badge(343,158,2);
  s+=rect(63,211,374,174,'#f9fbfe',12)+rect(85,233,52,52,C.pale,11)+text(102,266,'▯',30,C.blue)+text(153,254,'书签导航台',22,C.ink,650)+text(153,282,'1.13.2 · 已启用',16,C.muted)+text(85,348,'详情       移除       重新加载',17,C.muted)+toggle(355,328);
  s+=windowBox(486,166,563,280,'选择刚才解压出来的文件夹')+text(511,247,'文档 / 书签导航台',19,C.muted)+rect(510,267,515,39,C.pale,7,C.pale)+text(527,293,'▸  解压后的 Chrome 文件夹',19,C.blue,600)+text(527,335,'选中文件夹，再点击下方按钮',18,C.muted)+button(831,383,193,'选择文件夹')+badge(1013,248,3);
  s+=text(63,464,'4  打开一个新标签页，确认显示“书签导航台”',19,C.ink,600);
  s+=text(45,529,'下载 ZIP → 解压 → 开启开发者模式 → 选择刚才解压出来的文件夹',18,C.muted);
  svg('chromium-install',551,'Chrome 与 Edge 的本地安装步骤',s);

  s=windowBox(32,24,1056,462,'about:debugging#/runtime/this-firefox');
  s+=rect(33,70,193,416,'#f9fbfe',0)+text(52,118,'调试',25,C.ink,600)+rect(47,146,160,43,C.pale,8,C.pale)+text(61,175,'此 Firefox',20,C.blue,600);
  s+=text(255,118,'此 Firefox',26,C.ink,650)+button(255,151,238,'临时载入附加组件')+badge(520,173,1);
  s+=text(255,229,'临时扩展',21,C.muted)+rect(255,252,248,93,C.pale,10,C.pale)+text(275,286,'书签导航台',21,C.ink,600)+text(275,319,'重新载入 · 移除',16,C.muted);
  s+=windowBox(560,183,480,242,'选择扩展中的文件')+text(584,263,'Firefox 解压目录',20,C.muted)+rect(582,283,435,43,C.pale,7,C.pale)+text(600,311,'manifest.json',21,C.blue,650)+badge(1000,305,2)+button(814,357,202,'打开');
  s+=text(254,457,'3  新建标签页，阅读首次使用说明',18,C.ink,600)+text(46,528,'临时安装在 Firefox 重启后失效；长期安装需要 Mozilla 签名。',18,C.muted);
  svg('firefox-install',550,'Firefox 临时载入操作',s);

  s=windowBox(36,31,1048,333,'bookmarknavigator · Safari 安装磁盘');
  s+=rect(207,123,105,105,C.pale,22,C.pale)+text(239,193,'▯',54,C.blue,500)+text(143,267,'bookmarknavigator.app',22,C.ink,600)+badge(158,169,1);
  s+=rect(728,124,125,94,'#dce8fb',13,'#bfd1ed')+rect(729,112,55,24,'#dce8fb',7,'#bfd1ed')+text(700,267,'Applications',24,C.ink,650)+text(728,298,'应用程序',19,C.muted)+badge(890,164,2)+arrow(383,172,655,172);
  s+=text(382,216,'把 App 拖到这里',21,C.blue,650)+text(58,405,'3  从“应用程序”打开 App，按“安装与启用”面板完成 Safari 设置。',20,C.ink,600);
  svg('safari-app',435,'Safari App 安装到应用程序',s);

  s=windowBox(33,27,502,375,'Safari 设置 · 高级');
  s+=text(60,120,'高级',27,C.ink,650)+check(64,164,'显示网页开发者功能',true,21)+badge(480,179,1)+text(64,228,'首次设置：打开开发者选项',18,C.muted);
  s+=windowBox(585,27,502,375,'Safari 设置 · 开发者')+text(612,120,'开发者',27,C.ink,650)+check(615,164,'允许未签名的扩展',true,21)+badge(1034,179,2)+text(615,229,'在系统窗口完成验证',18,C.muted)+arrow(546,185,575,185);
  s+=rect(63,277,444,88,C.pale,10,C.pale)+text(81,309,'Safari 17+：使用“开发者”设置',18,C.blue)+text(81,337,'Safari 16：使用菜单栏“开发”',18,C.blue);
  s+=text(56,449,'完全退出 Safari 后，此选项重置。下次启动重新勾选即可，无需重装 App。',19,C.ink,600)+text(57,484,'这是免费测试包的使用步骤；项目没有永久保留此选项的可靠方法。',17,C.muted);
  svg('safari-unsigned',512,'Safari 允许未签名扩展的位置',s);

  s=windowBox(33,26,502,385,'Safari 设置 · 扩展');
  s+=text(62,118,'扩展',27,C.ink,650)+rect(60,144,448,63,C.pale,9,C.pale)+check(80,165,'书签导航台',true,22)+badge(474,176,1)+text(63,252,'先把 App 放入应用程序并打开一次',18,C.muted)+text(63,285,'然后在扩展列表中启用',18,C.muted);
  s+=windowBox(585,26,502,385,'Safari 设置 · 通用')+text(614,118,'通用',27,C.ink,650)+text(614,180,'新建标签页时打开：',21)+rect(613,198,445,55,C.pale,8,C.blue)+text(634,232,'书签导航台                     ▾',22,C.blue,600)+badge(1037,181,2)+text(614,298,'新建窗口也可设置为书签导航台',18,C.muted);
  s+=text(58,456,'3  新建一个标签页 → 阅读首次说明 → 在设置中导入书签',20,C.ink,600);
  svg('safari-enable',493,'启用 Safari 扩展并设置新标签页',s);

  s=windowBox(31,28,1058,52,'Safari 文件菜单 → 将浏览数据导出到文件');
  s+=windowBox(32,106,336,321,'1 · 只导出书签')+check(57,180,'书签',true,22)+check(57,224,'阅读列表',false)+check(57,264,'历史记录',false)+check(57,304,'信用卡和密码',false)+button(217,362,125,'导出');
  s+=windowBox(395,106,322,321,'2 · 解压 ZIP')+rect(470,183,90,89,C.pale,13,C.pale)+text(492,235,'ZIP',28,C.blue,650)+text(417,309,'解压后选择 HTML 文件',20,C.ink,600)+text(419,342,'示例：书签.html',19,C.muted);
  s+=windowBox(744,106,344,321,'3 · 导入导航台')+text(764,185,'设置 > 本地书签',22,C.ink,650)+button(764,214,300,'导入书签 HTML')+text(764,290,'选择刚解压得到的 HTML',18,C.muted)+text(764,326,'出现“导入 · 文件名”目录',18,C.muted);
  s+=arrow(372,250,390,250)+arrow(721,250,739,250)+rect(49,458,1022,91,C.pale,12,C.pale)+text(71,491,'默认导入保存独立副本，整理它不会修改 Safari 原书签。',21,C.blue,600)+text(71,527,'重复导入会新增文件夹；Safari 16–18 的“导出书签”可直接得到 HTML。',18,C.muted);
  svg('safari-import',578,'Safari 导出、解压与本地导入',s);

  s=windowBox(32,26,325,430,'1 · 首页右上角设置');
  s+=text(55,119,'设置',26,C.ink,650)+rect(57,151,276,61,C.pale,9,C.pale)+text(74,188,'页面布局                 ›',22,C.blue,600)+text(61,248,'分类方式、顺序、显示',18,C.muted)+text(61,278,'首页模块与显示数量',18,C.muted);
  s+=windowBox(389,26,699,430,'2 · 分类顺序与显示');
  s+=text(415,118,'原顺序',20,C.muted)+text(789,118,'拖动中的落点预览',20,C.blue,600);
  ['工作','学习','设计','工具'].forEach((label,i)=>{const y=142+i*66;s+=rect(414,y,255,54,'#f7f9fd',9)+text(432,y+34,'⠿   '+label,22)});
  const order=['学习','设计','工作','工具'];order.forEach((label,i)=>{const y=142+i*66;s+=`<g opacity="${label==='工作'?.35:1}">${rect(788,y,271,54,label==='工作'?C.pale:'#f7f9fd',9,label==='工作'?C.blue:C.line)+text(806,y+34,'⠿   '+label,22)}</g>`});
  s+=line(790,270,1056,270,C.blue,4)+arrow(682,193,766,282)+text(416,429,'相邻条目平滑让位，蓝线提示插入位置',19,C.muted);
  s+=rect(55,486,1013,61,C.pale,10,C.pale)+text(77,525,'3  松手保存    ·    Esc 或拖出列表取消    ·    点击名称切换显示',21,C.blue,600);
  svg('layout-sort',575,'分类拖拽的让位与落点提示',s);

  s=windowBox(33,26,363,401,'1 · 点击日期');
  s+=text(63,120,'2026 年 10 月',25,C.ink,650)+text(62,167,'日  一  二  三  四  五  六',19,C.muted);
  for(let i=0;i<21;i++){const x=63+(i%7)*43,y=191+Math.floor(i/7)*55;if(i===13)s+=rect(x-6,y-1,36,38,C.blue,8,C.blue);s+=text(x,y+25,(i+1).toString(),18,i===13?'#fff':C.ink)}
  s+=text(64,393,'选择你要安排的那一天',19,C.muted);
  s+=windowBox(429,26,659,401,'2 · 填写时间与内容')+text(459,118,'待办事项 · 当天',25,C.ink,650);
  s+=button(459,148,135,'时间点',false)+button(604,148,152,'时间区间')+text(463,236,'开始',19,C.muted)+rect(515,207,132,44,C.pale,8,C.pale)+text(531,236,'14:00  ▾',21)+text(664,236,'至',19,C.muted)+rect(700,207,131,44,C.pale,8,C.pale)+text(716,236,'15:00  ▾',21);
  s+=text(462,286,'标记颜色',18,C.muted);['#e97148','#eac989','#88cbb5','#97bceb','#cba1e7'].forEach((color,i)=>s+=`<circle cx="${594+i*45}" cy="279" r="14" fill="${color}"/>`);
  s+=rect(459,316,412,52,'#fff',9)+text(478,349,'阅读技术文档',22,C.muted)+button(889,321,168,'添加')+badge(1050,307,3);
  s+=text(53,478,'待办保存到扩展本地存储；不会写入系统日历，也没有云端待办同步。',18,C.muted);
  svg('todo',506,'添加时间区间待办的步骤',s);

  s=windowBox(34,26,1052,414,'设置 > 本地书签 · 数据来源示意');
  s+=text(64,121,'当前数据源：本地导入库',27,C.ink,650)+text(64,160,'本地副本与 Safari 原书签分开保存',20,C.muted)+button(63,195,270,'导入书签 HTML')+button(349,195,252,'导出本地书签',false);
  s+=rect(63,266,993,129,C.pale,10,C.pale)+text(83,301,'开启实验原生同步后，在这里查看：',21,C.blue,600)+text(83,337,'连接状态  ·  上次成功同步时间  ·  同步中或失败原因',20,C.blue)+text(83,373,'同步设置在 macOS App 的“书签同步（可选）”面板中完成',18,C.muted);
  s+=text(53,483,'导出本地书签不包含原生同步快照、配置、待办、隐藏项和回收站。',18,C.muted);
  svg('library',511,'Safari 本地书签设置入口',s);

  s=windowBox(33,26,502,414,'bookmarknavigator/ · 源码仓库目录')+text(59,118,'提交到 GitHub 仓库',25,C.ink,650);
  ['README.md + README.html','src/  +  safari/','scripts/  +  tests/','docs/  +  配图','package.json  +  LICENSE','.gitignore  +  .gitattributes'].forEach((v,i)=>s+=text(62,161+i*39,v,20,i===0?C.blue:C.ink));
  s+=windowBox(585,26,502,414,'release-assets/ · 当前发布附件')+text(611,118,'上传到 Release 的 Assets',25,C.ink,650);
  ['Chrome ZIP  +  Edge ZIP','Firefox ZIP（临时测试）','Safari DMG  +  App ZIP','Safari WebExtension 资源 ZIP','SHA256SUMS.txt'].forEach((v,i)=>s+=text(615,164+i*43,v,20,i===4?C.blue:C.ink));
  s+=text(53,483,'源码提交不包含 dist、safari-build、release、旧版安装包、日志和凭据。',18,C.muted);
  svg('repository',511,'源码仓库与发布附件的目录分工',s);

  s=windowBox(30,27,327,375,'1 · 创建空仓库')+text(52,124,'Repository name',18,C.muted)+rect(53,142,280,48,'#fff',7)+text(66,172,'bookmarknavigator',20,C.ink,600)+check(56,224,'添加 README（不勾选）',false,17)+check(56,266,'添加 License（不勾选）',false,17)+button(55,327,278,'Create repository');
  s+=windowBox(396,27,327,375,'2 · 提交干净源码')+text(420,117,'仓库根目录应直接出现：',18,C.muted);
  ['README.md','package.json','src/   safari/','scripts/   tests/   docs/'].forEach((v,i)=>s+=text(421,160+i*42,v,20,C.blue,500));
  s+=text(420,356,'使用 Git 或分批网页上传',17,C.muted);
  s+=windowBox(762,27,328,375,'3 · 创建 Release')+text(786,116,'Tag: v1.13.2',21,C.ink,600)+rect(786,139,280,74,C.pale,8,C.pale)+text(804,169,'上传 release-assets/',19,C.blue)+text(804,195,'内的安装包与校验文件',17,C.blue)+check(788,244,'This is a pre-release',true,16)+button(787,325,279,'Publish release');
  s+=arrow(364,204,387,204)+arrow(729,204,752,204)+text(48,450,'源码目录提交到仓库；安装包作为 Release 附件；当前免费版本标为测试发布。',18,C.muted);
  svg('github-publish',477,'创建 GitHub 仓库与 Release 的步骤',s);
}
if(require.main===module) { makeIllustrations(); console.log('Created 13 original SVG instruction diagrams.'); }
module.exports={makeIllustrations};
