'use strict';
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
const { create, treeFromHTML } = require('../src/safari-sync.js');
const { createLibrary } = require('../src/local-bookmarks.js');
const clone = value => JSON.parse(JSON.stringify(value));
function storage() {
  const values = {};
  return { get: async key => key in values ? ({ [key]: clone(values[key]) }) : {}, set: async value => Object.assign(values, clone(value)) };
}
const parser = text => ({ nodes: JSON.parse(text), skipped: 0 });
const fixture = [{ title: '工作', children: [{ title: '甲 & 乙', url: 'https://example.org/', sourceTitle: '甲 & 乙', sourceURL: 'https://example.org/' }] }];
const build = (text, seen, now) => treeFromHTML(text, seen, now, parser);
const leaves = tree => tree.flatMap(node => node.url ? [node] : leaves(node.children || []));
(async () => {
  const seen = {}, first = await build(JSON.stringify(fixture), seen, 10);
  const added = clone(fixture); added[0].children.unshift({ title: '新书签', url: 'https://new.example/' });
  const second = await build(JSON.stringify(added), seen, 20);
  assert.equal(leaves(first)[0].id, leaves(second)[1].id);
  assert.equal(leaves(second)[1].dateAdded, 10); assert.equal(leaves(second)[0].dateAdded, 20);
  const duplicate = clone(fixture); duplicate[0].children.push(clone(duplicate[0].children[0]));
  const duplicatedTree = await build(JSON.stringify(duplicate), {}, 10);
  assert.notEqual(leaves(duplicatedTree)[0].id, leaves(duplicatedTree)[1].id);

  const store = storage(), local = createLibrary(store); let localRemoves = 0;
  const originalRemove = local.bookmarks.remove;
  local.bookmarks.remove = (...args) => { localRemoves++; return originalRemove(...args); };
  let native = { ok: true, enabled: true, running: true, html: JSON.stringify(fixture), digest: 'v1', updatedAt: 10 };
  const calls = []; let result = { ok: true, pending: true }, nativeFailure = false;
  const api = { storage: { local: store } };
  const sync = create(api, local, { buildTree: build, wait: async () => {}, send: async message => {
    calls.push(message);
    if (nativeFailure) throw new Error('disconnected');
    if (message.action === 'snapshot') return clone(native);
    if (message.action === 'delete') {
      native = { ...native, html: JSON.stringify([{ title: '工作', children: [] }]), digest: 'v2' };
      result = { ok: true, deleted: true }; return { ok: true, job: 'test-job' };
    }
    return result;
  } });
  const id = leaves(await sync.bookmarks.getTree())[0].id;
  await assert.rejects(sync.bookmarks.update(id, { title: 'x' }), /暂不支持/);
  await assert.rejects(sync.bookmarks.removeTree('safari-bar'), /暂不支持/);
  native.running = false;
  await assert.rejects(sync.bookmarks.remove(id), /未运行/); assert.equal(localRemoves, 0);
  native.running = true; nativeFailure = true;
  assert.equal(leaves(await sync.bookmarks.getTree())[0].id, id);
  await assert.rejects(sync.bookmarks.remove(id), /连接失败/); assert.equal(localRemoves, 0);
  nativeFailure = false; native.html = '{broken'; native.digest = 'broken';
  assert.equal(leaves(await sync.bookmarks.getTree())[0].id, id); assert.match(sync.status().transportError, /JSON/);
  native.html = JSON.stringify(duplicate); native.digest = 'duplicate';
  const duplicateId = leaves(await sync.bookmarks.getTree())[0].id;
  await assert.rejects(sync.bookmarks.remove(duplicateId), /同名同网址/);
  assert.equal(calls.filter(call => call.action === 'delete').length, 0);
  native.html = JSON.stringify(fixture); native.digest = 'v1';
  await sync.bookmarks.getTree(); await sync.bookmarks.remove(id);
  assert.equal(leaves(await sync.bookmarks.getTree()).length, 0); assert.equal(localRemoves, 0);
  const deletion = calls.find(call => call.action === 'delete');
  assert.equal(deletion.title, '甲 & 乙'); assert.equal(deletion.url, 'https://example.org/'); assert.equal(deletion.digest, 'v1');
  native.enabled = false;
  await assert.rejects(sync.bookmarks.remove(id), /已关闭/); assert.equal(localRemoves, 0);
  const localNode = await local.bookmarks.create({ title: '本地', url: 'https://local.example/' });
  await sync.bookmarks.remove(localNode.id); assert.equal(localRemoves, 1);
  // 助手心跳有效时等待最终结果；退出时保留未完成状态。
  let polls = 0, stopped = false;
  const slowNative = { ok: true, enabled: true, running: true, busy: false, html: JSON.stringify(fixture), digest: 'slow', updatedAt: 30 };
  const slow = create(api, local, { buildTree: build, wait: async () => {}, send: async message => {
    if (message.action === 'snapshot') return { ...slowNative, running: !stopped };
    if (message.action === 'delete') { slowNative.busy = true; return { ok: true, job: 'slow-job' }; }
    polls++;
    if (stopped || polls <= 600) return { ok: true, pending: true };
    return { ok: true, deleted: true };
  } });
  const slowId = leaves(await slow.bookmarks.getTree())[0].id;
  await slow.bookmarks.remove(slowId);
  assert.equal(polls, 601);
  slowNative.busy = false;
  stopped = true; polls = 0;
  const interrupted = create(api, local, { buildTree: build, wait: async () => {}, send: async message => {
    if (message.action === 'snapshot') return { ...slowNative, running: polls === 0 };
    if (message.action === 'delete') return { ok: true, job: 'interrupted-job' };
    polls++; return { ok: true, pending: true };
  } });
  const interruptedId = leaves(await interrupted.bookmarks.getTree())[0].id;
  await assert.rejects(interrupted.bookmarks.remove(interruptedId), /结果尚未确认.*勿重复提交/);
  polls = 0;
  const lost = create(api, local, { buildTree: build, wait: async () => {}, send: async message => {
    if (message.action === 'snapshot') return slowNative;
    if (message.action === 'delete') return { ok: true, job: 'lost-job' };
    polls++; return { ok: true, pending: true };
  } });
  const lostId = leaves(await lost.bookmarks.getTree())[0].id;
  await assert.rejects(lost.bookmarks.remove(lostId), /结果尚未确认.*勿重复提交/);
  assert.equal(polls, 16);
  assert.equal(localRemoves, 1);
  console.log('PASS: Safari sync stable identities, first-seen dates, stale-cache recovery, duplicate refusal, helper failure and deletion source isolation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
