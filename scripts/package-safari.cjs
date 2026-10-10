'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: npm run package:safari [-- --signed]\nDefault: universal macOS local-test App, ZIP and DMG.\n--signed: requires SAFARI_SIGN_IDENTITY (Developer ID Application certificate).\nOptional: SAFARI_BUNDLE_ID, SAFARI_APP_GROUP, SAFARI_NOTARY_PROFILE (notarize/staple signed build), SAFARI_APP_PROFILE, SAFARI_EXTENSION_PROFILE.');
  process.exit(0);
}
if (args.some(a => a !== '--signed')) throw new Error('Unknown option; use --help');
if (process.platform !== 'darwin') throw new Error('Safari App packaging requires macOS. Run npm run release for portable WebExtension ZIPs.');
const signed = args.includes('--signed');
const identity = signed ? process.env.SAFARI_SIGN_IDENTITY : '-';
if (signed && (!identity || !identity.startsWith('Developer ID Application:'))) throw new Error('--signed requires SAFARI_SIGN_IDENTITY="Developer ID Application: …"');
const notaryProfile = signed && process.env.SAFARI_NOTARY_PROFILE;
const bundleId = process.env.SAFARI_BUNDLE_ID || 'com.drmush.bookmarknavigator';
const appGroup = process.env.SAFARI_APP_GROUP || 'group.' + bundleId;
if (!/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(appGroup)) throw new Error('Invalid SAFARI_APP_GROUP');
if (!/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(bundleId)) throw new Error('Invalid SAFARI_BUNDLE_ID');
function run(file, argv, capture = false) {
  return execFileSync(file, argv, { cwd: ROOT, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' });
}
const sdk = run('/usr/bin/xcrun', ['--show-sdk-path'], true).trim();
run('/usr/bin/xcrun', ['--find', 'clang'], true);
if (notaryProfile) run('/usr/bin/xcrun', ['--find', 'notarytool'], true);
require('./docs.cjs').buildDocs();
require('./build.cjs');
const version = require('../package.json').version;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmarknavigator-safari-'));
const release = path.join(ROOT, 'release'); fs.mkdirSync(release, { recursive: true });
fs.copyFileSync(path.join(ROOT,'README.html'),path.join(release,`bookmarknavigator-v${version}-readme.html`));
const app = path.join(temp, 'bookmarknavigator.app');
const extension = path.join(app, 'Contents', 'PlugIns', 'bookmarknavigator Extension.appex');
const xml = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
function plist(file, values, extra = '') {
  const entries = Object.entries(values).map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`).join('\n');
  fs.writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n${entries}\n${extra}\n</dict></plist>\n`);
  run('/usr/bin/plutil', ['-lint', file]);
}
function compile(source, destination, isExtension) {
  const binaries = [];
  for (const arch of ['arm64', 'x86_64']) {
    const output = path.join(temp, path.basename(source) + '.' + arch);
    const flags = ['clang', '-target', `${arch}-apple-macos12.0`, '-isysroot', sdk, '-fobjc-arc', '-fmodules', '-O2', '-Wall', '-Werror',
      '-fmodules-cache-path=' + path.join(temp, 'modules'), path.join(ROOT, 'safari', source), '-o', output, '-framework', 'Foundation'];
    flags.push(path.join(ROOT, 'safari', 'SyncShared.m'), '-lz', '-framework', 'SafariServices');
    // appex 需编译为可执行文件，以携带沙盒和 App Group 权限。
    if (isExtension) flags.push('-fapplication-extension', '-Wl,-e,_NSExtensionMain');
    else flags.push(path.join(ROOT, 'safari', 'SyncCoordinator.m'), path.join(ROOT, 'safari', 'SafariAutomation.m'),
      '-framework', 'Cocoa', '-framework', 'ApplicationServices', '-framework', 'Carbon');
    run('/usr/bin/xcrun', flags); binaries.push(output);
  }
  run('/usr/bin/xcrun', ['lipo', '-create', ...binaries, '-output', destination]);
  fs.chmodSync(destination, 0o755);
}
try {
  for (const bundle of [app, extension]) {
    fs.mkdirSync(path.join(bundle, 'Contents', 'MacOS'), { recursive: true });
    fs.mkdirSync(path.join(bundle, 'Contents', 'Resources'), { recursive: true });
  }
  fs.cpSync(path.join(ROOT, 'dist', 'safari-web-extension'), path.join(extension, 'Contents', 'Resources'), { recursive: true });
  const common = { CFBundleShortVersionString: version, CFBundleVersion: version,
    HubSyncTransport: signed ? 'app-group' : 'extension-container', HubExtensionIdentifier: bundleId + '.Extension',
    CFBundleInfoDictionaryVersion: '6.0', LSMinimumSystemVersion: '12.0' };
  plist(path.join(app, 'Contents', 'Info.plist'), {
    ...common, CFBundleIdentifier: bundleId, CFBundleName: 'bookmarknavigator', CFBundleDisplayName: '书签导航台',
    CFBundleExecutable: 'bookmarknavigator', CFBundlePackageType: 'APPL', CFBundleIconFile: 'AppIcon', HubAppGroup: appGroup,
    NSPrincipalClass: 'NSApplication', HubBuildMode: signed ? 'Developer ID 签名版' : '本地测试版',
    NSHumanReadableCopyright: 'Copyright © DrMush. MIT License.'
  }, '<key>NSHighResolutionCapable</key><true/>');
  plist(path.join(extension, 'Contents', 'Info.plist'), {
    ...common, CFBundleIdentifier: bundleId + '.Extension', CFBundleName: 'bookmarknavigator Extension',
    CFBundleDisplayName: '书签导航台', CFBundleExecutable: 'SafariWebExtensionHandler', CFBundlePackageType: 'XPC!', HubAppGroup: appGroup
  }, '<key>NSExtension</key><dict><key>NSExtensionPointIdentifier</key><string>com.apple.Safari.web-extension</string><key>NSExtensionPrincipalClass</key><string>SafariWebExtensionHandler</string></dict>');
  const iconset = path.join(temp, 'AppIcon.iconset'); fs.mkdirSync(iconset);
  for (const size of [16, 32, 128]) {
    run('/usr/bin/sips', ['-z', String(size), String(size), path.join(ROOT, 'src', 'icons', 'icon128.png'), '--out', path.join(iconset, `icon_${size}x${size}.png`)], true);
    if (size <= 32) run('/usr/bin/sips', ['-z', String(size * 2), String(size * 2), path.join(ROOT, 'src', 'icons', 'icon128.png'), '--out', path.join(iconset, `icon_${size}x${size}@2x.png`)], true);
  }
  run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(app, 'Contents', 'Resources', 'AppIcon.icns')]);
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(app, 'Contents', 'Resources', 'LICENSE.txt'));
  const resourceNotice = fs.readFileSync(path.join(ROOT, 'src', 'licenses', 'index.html'), 'utf8')
    .replace(/href="((?!https?:|mailto:|#)[^"]+)"/g, (_, url) => `href="licenses/${url}"`);
  fs.writeFileSync(path.join(app, 'Contents', 'Resources', '第三方资源版权与许可.html'), resourceNotice);
  fs.writeFileSync(path.join(app, 'Contents', 'Resources', 'THIRD_PARTY_NOTICES.md'),
    fs.readFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8').replace(/\]\(src\/licenses\//g, '](licenses/').replace('](LICENSE)', '](LICENSE.txt)'));
  fs.cpSync(path.join(ROOT, 'src', 'licenses'), path.join(app, 'Contents', 'Resources', 'licenses'), { recursive: true });
  const guide = require('./docs.cjs').safariQuickstart({ signed, appVersion: version });
  fs.writeFileSync(path.join(app, 'Contents', 'Resources', '安装指南.html'), guide);
  const guideMarkdown = require('./docs.cjs').safariMarkdown({ signed }).replace(/\]\(assets\//g, '](使用指南/docs/assets/').replace(/\]\(safari-sync\.md\)/g, '](使用指南/docs/safari-sync.md)');
  fs.writeFileSync(path.join(app, 'Contents', 'Resources', '安装说明.md'), guideMarkdown);
  function copyGuides(destination) {
    fs.mkdirSync(destination, { recursive: true });
    for (const file of ['README.md', 'README.html', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.html']) fs.copyFileSync(path.join(ROOT, file), path.join(destination, file));
    fs.mkdirSync(path.join(destination, 'src'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'src', 'licenses'), path.join(destination, 'src', 'licenses'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'docs'), path.join(destination, 'docs'), { recursive: true,
      filter: entry => { const name = path.basename(entry); return name !== '.DS_Store' && !name.startsWith('._') && !/^(?:maintainer|safari-packaging)\.(?:md|html)$/.test(name) && !['repository.svg', 'github-publish.svg'].includes(name); } });
  }
  copyGuides(path.join(app, 'Contents', 'Resources', '使用指南'));
  compile('App.m', path.join(app, 'Contents', 'MacOS', 'bookmarknavigator'), false);
  compile('Extension.m', path.join(extension, 'Contents', 'MacOS', 'SafariWebExtensionHandler'), true);
  for (const [env, bundle] of [['SAFARI_APP_PROFILE', app], ['SAFARI_EXTENSION_PROFILE', extension]]) {
    if (signed && process.env[env]) fs.copyFileSync(process.env[env], path.join(bundle, 'Contents', 'embedded.provisionprofile'));
  }
  const signFlags = signed ? ['--options', 'runtime', '--timestamp'] : [];
  for (const bundle of [extension, app]) {
    const entitlement = path.join(temp, bundle === app ? 'host-entitlements.plist' : 'extension-entitlements.plist');
    // 辅助功能宿主使用非沙盒进程，扩展保留 App Sandbox。
    plist(entitlement, {}, (bundle === extension ? '<key>com.apple.security.app-sandbox</key><true/>' : '') +
      (signed ? `<key>com.apple.security.application-groups</key><array><string>${xml(appGroup)}</string></array>` : ''));
    run('/usr/bin/codesign', ['--force', '--sign', identity, '--entitlements', entitlement, ...signFlags, bundle]);
  }
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const extensionType = run('/usr/bin/file', ['-b', path.join(extension, 'Contents', 'MacOS', 'SafariWebExtensionHandler')], true);
  if (!extensionType.includes('executable') || extensionType.includes('bundle')) throw new Error('Safari .appex must be a Mach-O executable');
  for (const bundle of [app, extension]) {
    const entitlements = run('/usr/bin/codesign', ['--display', '--entitlements', ':-', bundle], true);
    if (signed && !entitlements.includes(appGroup)) throw new Error('App Group entitlement missing from signed binary');
    const sandboxed = /<key>com\.apple\.security\.app-sandbox<\/key>\s*<true\s*\/>/.test(entitlements);
    if (sandboxed !== (bundle === extension)) throw new Error('Incorrect native sandbox entitlement');
  }
  if (notaryProfile) {
    const submission = path.join(temp, 'notarize.zip');
    run('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, submission]);
    run('/usr/bin/xcrun', ['notarytool', 'submit', submission, '--keychain-profile', notaryProfile, '--wait']);
    run('/usr/bin/xcrun', ['stapler', 'staple', app]);
    run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
  }
  const mode = notaryProfile ? 'macos' : signed ? 'macos-signed-unnotarized' : 'macos-local';
  const name = `bookmarknavigator-v${version}-${mode}`;
  const stage = path.join(temp, 'disk'); fs.mkdirSync(stage);
  run('/usr/bin/ditto', [app, path.join(stage, 'bookmarknavigator.app')]);
  fs.symlinkSync('/Applications', path.join(stage, 'Applications'));
  fs.writeFileSync(path.join(stage, '安装说明.md'), guideMarkdown);
  fs.writeFileSync(path.join(stage, '安装指南.html'), guide);
  copyGuides(path.join(stage, '使用指南'));
  run('/usr/bin/hdiutil', ['create', '-volname', 'bookmarknavigator', '-srcfolder', stage, '-ov', '-format', 'UDZO', path.join(release, name + '.dmg')]);
  // ZIP 保留可执行权限，排除 Finder 元数据。
  run('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--noextattr', '--keepParent', app, path.join(release, name + '.zip')]);
  const appOutput = path.join(ROOT, 'safari-build', 'bookmarknavigator.app');
  fs.mkdirSync(path.dirname(appOutput), { recursive: true });
  fs.rmSync(appOutput, { recursive: true, force: true }); run('/usr/bin/ditto', [app, appOutput]);
  require('./release.cjs').checksums();
  console.log(`Created release/${name}.dmg and .zip\nApp: ${appOutput}`);
  if (!notaryProfile) console.log(signed ? 'Signed, not notarized.' : 'Local test build (ad-hoc, not notarized). Enable unsigned extensions in Safari.');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
