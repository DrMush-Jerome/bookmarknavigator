'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {zipDirectory}=require('./lib/archive.cjs');
const ROOT=path.resolve(__dirname,'..'), version=require('../package.json').version;
const args=process.argv.slice(2);
if(args.includes('--help')){console.log('npm run prepare:github [-- --output <new-directory>]\nCreates a clean repository folder, current release assets, source ZIP and an offline start page. Never overwrites existing output.');process.exit(0)}
if(args.length && (args.length!==2||args[0]!=='--output'||!args[1]))throw new Error('Use --help for supported arguments.');
const output=args.length?path.resolve(args[1]):path.join(ROOT,'delivery','v'+version);
if(fs.existsSync(output))throw new Error('Output already exists; choose a new --output directory.');
const insideRoot=output===ROOT||output.startsWith(ROOT+path.sep);
if(insideRoot&&!output.startsWith(path.join(ROOT,'delivery')+path.sep))throw new Error('Inside this project, output must be under delivery/ to avoid copying generated files into source.');
if(ROOT.startsWith(output+path.sep))throw new Error('Output cannot be a parent of this project.');
require('./docs.cjs').buildDocs();
const files=['.gitignore','.gitattributes','LICENSE','THIRD_PARTY_NOTICES.md','THIRD_PARTY_NOTICES.html','package.json','README.md','README.html'];
const folders=['src','safari','scripts','tests','docs'];
for(const entry of [...files,...folders])if(!fs.existsSync(path.join(ROOT,entry)))throw new Error('Missing source: '+entry);
const suffixes=['chrome.zip','edge.zip','firefox.zip','safari-web-extension.zip','macos-local.dmg','macos-local.zip','readme.html'];
const assets=suffixes.map(suffix=>`bookmarknavigator-v${version}-${suffix}`);
const release=path.join(ROOT,'release'), sumsFile=path.join(release,'SHA256SUMS.txt');
if(!fs.existsSync(sumsFile))throw new Error('Run npm run release and npm run package:safari first.');
const sums=new Map(fs.readFileSync(sumsFile,'utf8').trim().split('\n').map(line=>{const match=line.match(/^([a-f0-9]{64})\s+(.+)$/);if(!match)throw new Error('Invalid checksum line');return [match[2],match[1]]}));
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for(const asset of assets){const file=path.join(release,asset);if(!fs.existsSync(file))throw new Error('Missing current release asset: '+asset+'; build it before preparing delivery.');if(digest(file)!==sums.get(asset))throw new Error('Checksum mismatch: '+asset);}
if(digest(path.join(ROOT,'README.html'))!==digest(path.join(release,`bookmarknavigator-v${version}-readme.html`)))throw new Error('Standalone release guide is out of date; run npm run release again.');
const keep=entry=>{const name=path.basename(entry);return !['.DS_Store','Thumbs.db','__MACOSX','.git','.env','node_modules'].includes(name)&&!name.startsWith('._')&&!(name.startsWith('.env.')&&name!=='.env.example')&&!/\.(?:log|p12|pfx|cer|pem|key|mobileprovision|provisionprofile)$/i.test(name)};
const repo=path.join(output,'bookmarknavigator'), upload=path.join(output,'release-assets');
function directoryGuide(){
  const privateDocs=fs.existsSync(path.join(ROOT,'developer/maintainer.md'));
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>交付目录说明</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f7fb;color:#26354c;font:16px/1.9 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}main{max-width:900px;margin:35px auto;padding:30px;background:white;border:1px solid #e1e7f0;border-radius:12px}h1{font-size:30px;margin:0 0 13px}h2{font-size:22px;margin-top:28px}a{color:#42699f}code{background:#f0f3f8;padding:2px 5px;border-radius:4px;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;border-bottom:1px solid #e1e7f0;padding:12px;vertical-align:top}th{background:#f5f7fb}img{width:100%;height:auto}nav{display:flex;gap:20px;flex-wrap:wrap;margin:20px 0}@media(max-width:600px){main{margin:12px;padding:21px}th,td{padding:8px}h1{font-size:26px}}</style><main><h1>哪些文件公开，哪些留在本机</h1><p>提交源码与上传安装包分别进行。公开仓库里的所有文件都能被他人读取，个人资料放在仓库之外。</p><nav><a href="开始阅读.html">用户文档</a>${privateDocs?'<a href="开发者资料/maintainer.html">个人维护与发布说明</a>':''}</nav><table><thead><tr><th>目录或文件</th><th>给谁使用</th><th>上传到哪里</th></tr></thead><tbody><tr><td><code>bookmarknavigator/</code></td><td>用户文档及完整开源代码</td><td>把里面的内容提交 GitHub 仓库</td></tr><tr><td><code>release-assets/</code></td><td>普通用户下载、安装与离线阅读</td><td>上传 GitHub Release 的 Assets</td></tr><tr><td><code>开发者资料/</code></td><td>你个人的维护、打包和发布说明</td><td>留在本机，不提交仓库、不打进安装包</td></tr><tr><td><code>bookmarknavigator-v${version}-source.zip</code></td><td>公开源码备份</td><td>可分享；不代替浏览器安装包</td></tr><tr><td>开始阅读.html、交付目录说明.html</td><td>本次交付的阅读入口</td><td>留在交付外层，不放进源码仓库</td></tr></tbody></table><h2>源码仓库内部</h2><p><code>README.md</code>、<code>README.html</code> 和 <code>docs/</code> 面向用户。<code>src/</code>、<code>safari/</code>、<code>scripts/</code>、<code>tests/</code>、<code>package.json</code> 与隐藏配置文件是开发用途的公开源码，保留它们才能让他人完整构建和验证项目。</p><p>构建产物、日志、旧包、账号凭据、证书私钥和私人书签不进入提交目录。${privateDocs?'具体步骤在独立的开发者资料中。':'当前源码不附本机的个人维护资料。'}</p></main></html>\n`;
}
let created=false;
try {
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.mkdirSync(output);created=true;
  fs.mkdirSync(repo);fs.mkdirSync(upload);
  for(const entry of [...files,...folders])fs.cpSync(path.join(ROOT,entry),path.join(repo,entry),{recursive:true,filter:keep});
  function normalize(dir){fs.chmodSync(dir,0o755);for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isSymbolicLink())throw new Error('Unexpected source symlink: '+file);if(entry.isDirectory())normalize(file);else fs.chmodSync(file,0o644)}}
  normalize(repo);
  for(const asset of assets)fs.copyFileSync(path.join(release,asset),path.join(upload,asset));
  fs.writeFileSync(path.join(upload,'SHA256SUMS.txt'),assets.map(asset=>sums.get(asset)+'  '+asset).join('\n')+'\n');
  zipDirectory(repo,path.join(output,`bookmarknavigator-v${version}-source.zip`));
  fs.writeFileSync(path.join(output,'开始阅读.html'),require('./docs.cjs').deliveryIndex());
  require('./docs.cjs').exportDeveloperDocs(path.join(output,'开发者资料'));
  fs.writeFileSync(path.join(output,'交付目录说明.html'),directoryGuide());
  console.log('Prepared clean delivery: '+output+'\nRepository: '+repo+'\nRelease uploads: '+upload);
} catch(error) {
  // 异常时仅清理本次创建的输出目录。
  if(created)fs.rmSync(output,{recursive:true,force:true});throw error;
}
