'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), child = require('node:child_process');
const { zipDirectory } = require('../scripts/lib/archive.cjs');
if (process.platform !== 'darwin') { console.log('SKIP: native archive reader requires macOS'); process.exit(0); }
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-native-archive-test-'));
let serial = 0;
function zip(entries) {
  const directory = path.join(temp, 'input-' + serial++); fs.mkdirSync(directory);
  for (const entry of entries) {
    const file = path.join(directory, entry.name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, entry.data);
  }
  const file = directory + '.zip'; zipDirectory(directory, file); return fs.readFileSync(file);
}
try {
  const html = '<!DOCTYPE NETSCAPE-Bookmark-file-1><DT><H3>收藏</H3><DL><DT><A HREF="https://example.org/?a=1&amp;b=2">甲 &amp; 乙</A></DL>';
  const cases = [
    ['bookmarks', [{ name: '导出/书签.html', data: Buffer.from(html) }, { name: '__MACOSX/._书签.html', data: Buffer.from('metadata') }], true],
    ['mixed', [{ name: '书签.html', data: Buffer.from(html) }, { name: 'Passwords.csv', data: Buffer.from('DO NOT READ') }], false],
    ['multiple', [{ name: 'a.html', data: Buffer.from(html) }, { name: 'b.html', data: Buffer.from(html) }], false],
    ['invalid', [{ name: 'a.html', data: Buffer.from('not bookmarks') }], false]
  ];
  const args = [];
  for (const [name, entries, accepted] of cases) {
    const file = path.join(temp, name + '.zip'); fs.writeFileSync(file, zip(entries)); args.push(file, accepted ? 'yes' : 'no');
  }
  const corrupt = zip([{ name: 'bookmarks.html', data: Buffer.from(html) }]);
  const central = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); corrupt[central + 16] ^= 1;
  const file = path.join(temp, 'crc.zip'); fs.writeFileSync(file, corrupt); args.push(file, 'no');
  if (process.env.SAFARI_BOOKMARK_ARCHIVE_TEST_FILE) args.push(process.env.SAFARI_BOOKMARK_ARCHIVE_TEST_FILE, 'actual');
  const source = path.join(temp, 'test.m');
  fs.writeFileSync(source, `#import <Foundation/Foundation.h>
#import "SyncShared.h"
int main(int argc, const char **argv) { @autoreleasepool {
  for (int i = 1; i + 1 < argc; i += 2) {
    NSError *error = nil; NSString *html = HubReadBookmarkArchive([NSURL fileURLWithPath:@(argv[i])], &error);
    BOOL expected = strcmp(argv[i + 1], "no") != 0;
    if ((html != nil) != expected) { fprintf(stderr, "archive expectation failed: %s\\n", argv[i]); return 1; }
    if (html && strcmp(argv[i + 1], "yes") == 0 && HubBookmarkMatchCount(html, @"甲 & 乙", @"https://example.org/?a=1&b=2") != 1) return 2;
  }
  if (HubBookmarkMatchCount(@"<A HREF=\\"https://x/\\">&#x1F600;</A><A HREF=\\"https://x/\\">&#128512;</A>", @"😀", @"https://x/") != 2) return 3;
  puts("PASS: native Safari archive Unicode, mixed-data rejection, duplicate HTML rejection, CRC validation and exact bookmark matching.");
} return 0; }
`);
  const root = path.resolve(__dirname, '..'), executable = path.join(temp, 'test');
  child.execFileSync('/usr/bin/xcrun', ['clang', '-fobjc-arc', '-O2', '-Wall', '-Werror', '-I', path.join(root, 'safari'), source,
    path.join(root, 'safari', 'SyncShared.m'), '-framework', 'Foundation', '-lz', '-o', executable], { stdio: 'inherit' });
  child.execFileSync(executable, args, { stdio: 'inherit' });
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
