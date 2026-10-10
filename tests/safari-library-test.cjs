'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const { createLibrary, exportHTML, safeURL } = require('../src/local-bookmarks.js');
const copy = value => JSON.parse(JSON.stringify(value));
(async () => {
  let state = {}, failWrite = false;
  const storage = {
    get: async key => copy({ [key]: state[key] }),
    set: async data => { if (failWrite) throw new Error('quota exceeded'); Object.assign(state, copy(data)); }
  };
  const library = createLibrary(storage), api = library.bookmarks;
  let notifications = 0; api.onChanged.addListener(() => notifications++);
  const parent = await api.create({ title: '工作' });
  const [first, second] = await Promise.all([
    api.create({ title: '<GitHub>', url: 'https://github.com', parentId: parent.id }),
    api.create({ title: 'MDN', url: 'https://developer.mozilla.org', parentId: parent.id })
  ]);
  assert.notEqual(first.id, second.id);
  assert.deepEqual((await api.getChildren(parent.id)).map(n => n.id), [first.id, second.id]);
  await api.move(first.id, { parentId: parent.id, index: 1 });
  assert.deepEqual((await api.getChildren(parent.id)).map(n => [n.id, n.index]), [[second.id, 0], [first.id, 1]]);
  const other = await api.create({ title: '阅读' });
  await api.move(second.id, { parentId: other.id, index: 0 });
  assert.equal((await api.get(second.id))[0].parentId, other.id);
  await api.update(first.id, { title: 'GitHub & 开发' });
  assert.equal((await api.get(first.id))[0].title, 'GitHub & 开发');
  const child = await api.create({ title: '子分类', parentId: parent.id });
  const before = await api.getTree();
  await assert.rejects(api.move(parent.id, { parentId: child.id }), /子文件夹/);
  await assert.rejects(api.move(parent.id, { parentId: 'missing' }), /找不到/);
  await assert.rejects(api.move(first.id, { index: -1 }), /无效/);
  await assert.rejects(api.remove(parent.id), /非空/);
  await assert.rejects(api.removeTree('local-bar'), /根目录/);
  await assert.rejects(api.create({ url: 'javascript:alert(1)' }), /协议/);
  assert.deepEqual(await api.getTree(), before, 'failed mutations must not change stored tree');
  const eventsBeforeFailure = notifications;
  failWrite = true;
  await assert.rejects(api.update(first.id, { title: 'lost' }), /quota/);
  failWrite = false;
  assert.equal(notifications, eventsBeforeFailure);
  assert.equal((await api.get(first.id))[0].title, 'GitHub & 开发');
  const group = await library.importNodes([{ title: '空分类', children: [] }, { title: 'Safari', url: 'https://apple.com' }], '导入');
  assert.equal(group.children.length, 2);
  assert.ok((await api.getSubTree(group.id))[0].children[0].children);
  const html = await library.exportHTML();
  assert.match(html, /GitHub &amp; 开发/);
  assert.match(html, /<H3>空分类<\/H3>/);
  assert.match(exportHTML(await api.getTree()), /NETSCAPE-Bookmark-file-1/);
  const again = createLibrary(storage);
  assert.deepEqual(await again.bookmarks.getTree(), await api.getTree(), 'new tabs must load persisted bookmarks');
  await library.recordVisit('https://github.com/a');
  await library.recordVisit('https://github.com/b');
  assert.equal((await again.history.search())[0].visitCount, 2);
  await api.removeTree(parent.id);
  await assert.rejects(api.get(first.id), /找不到/);
  assert.equal(safeURL('data:text/html,boom'), null);
  assert.equal(safeURL('https://example.org'), 'https://example.org/');
  const compat = fs.readFileSync(path.join(__dirname, '../src/compat.js'), 'utf8');
  const browser = { storage: { local: storage }, runtime: {}, tabs: {}, permissions: {}, scripting: {} };
  const context = { browser, HUB_LOCAL_BOOKMARKS: { createLibrary }, navigator: {} };
  vm.runInNewContext(compat, context);
  assert.ok(context.HUB_LOCAL_LIBRARY);
  assert.deepEqual(await context.HUB_API.bookmarks.getTree(), await api.getTree());
  const native = { bookmarks: { getTree() {} }, storage: { local: storage } };
  const nativeContext = { browser: native };
  vm.runInNewContext(compat, nativeContext);
  assert.equal(nativeContext.HUB_API, native, 'native APIs must be kept for Firefox/Chromium');
  const shadowed = { browser: {}, chrome: native };
  vm.runInNewContext(compat, shadowed);
  assert.equal(shadowed.HUB_API, native, 'partial browser globals must not shadow a working chrome API');
  console.log('PASS: Safari persistent library, concurrent edits, move/cycle protection, quota rollback, export and API selection.');
})().catch(error => { console.error(error); process.exitCode = 1; });
