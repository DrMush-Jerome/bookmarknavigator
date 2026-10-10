'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { publicOrigin, inventory, candidates, rasterSize, optimizeOne, boundedFetch, permissionGroups, optimizeBatch, requestAccess } = require('./../src/hires-icons.js');

test('origin normalization, deduplication, conservative private/special origin exclusion', () => {
  assert.equal(publicOrigin('https://Example.com:443/a?q=1'), 'https://example.com');
  assert.equal(publicOrigin('http://example.com:80/a'), 'http://example.com');
  for (const url of ['chrome://bookmarks', 'file:///etc/a', 'data:text/plain,x', 'javascript:alert(1)', 'bad url',
    'https://localhost/', 'http://a.localhost/', 'http://router/', 'http://nas.local/', 'https://work.internal/',
    'http://company.intranet/', 'https://a.home.arpa/', 'http://127.0.0.1/', 'http://0x7f000001/',
    'http://10.1.1.1/', 'http://192.168.1.1/', 'http://172.16.1.1/', 'http://169.254.1.1/',
    'http://[::1]/', 'http://[fd00::1]/', 'http://[::ffff:192.168.1.1]/', 'http://8.8.8.8/',
    'https://example.com:8443/', 'https://u:p@example.com/', 'https://example.com./']) {
    assert.equal(publicOrigin(url), null, url);
  }
  assert.deepEqual(inventory([{ items: [
    { url: 'https://example.com/a' }, { url: 'https://example.com/b' },
    { url: 'https://other.com/a' }, { url: 'http://localhost/' }, { url: 'http://localhost/' }
  ] }], { 'https://other.com': 'data:image/png;base64,old' }), {
    pending: ['https://example.com'], cached: ['https://other.com'], excluded: ['http://localhost/']
  });
});

test('candidate size sorting, SVG first, exact origin gating and bounded fallbacks', () => {
  const origin = 'https://example.com';
  const list = candidates(origin, [
    { rel: 'shortcut icon', href: '/small.png', sizes: '16x16 32x32' },
    { rel: 'apple-touch-icon', href: '/large.png#x', sizes: '512x512' },
    { rel: 'icon', href: '/medium.png', sizes: '128x128' },
    { rel: 'icon', href: '/wide.png', sizes: '1024x16' },
    { rel: 'icon', href: '/fifth.png', sizes: '1x1' },
    { rel: 'icon', href: 'https://cdn.example.com/huge.png', sizes: '9999x9999' },
    { rel: 'icon', href: 'http://example.com/a.png', sizes: '9999x9999' },
    { rel: 'icon', href: 'https://user@example.com/a.png', sizes: '9999x9999' },
    { rel: 'icon', href: 'https://example.com:444/a.png', sizes: '9999x9999' },
    { rel: 'icon', href: 'data:image/png;base64,aaaa', sizes: '9999x9999' },
    { rel: 'icon', href: '/vector.svg', sizes: 'any' },
    { rel: 'stylesheet', href: '/style.png', sizes: '9999x9999' }
  ]);
  assert.deepEqual(list, ['/vector.svg', '/large.png', '/medium.png', '/small.png', '/wide.png', '/fifth.png', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png', '/favicon.svg', '/favicon.ico'].map(p => origin + p));
  assert.deepEqual(candidates(origin, [{ rel: 'icon', href: '/favicon.ico', sizes: '256x256' }]), ['/favicon.ico', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png', '/favicon.svg'].map(p => origin + p));
});

test('real raster dimensions must pass both axes; conversion preserves aspect and never upscales', () => {
  for (const [w, h] of [[16,16], [64,64], [95,256], [1024,32], [0,128], [NaN,128], [8193,8193], [5000,5000]]) assert.equal(rasterSize(w, h), null);
  assert.deepEqual(rasterSize(96,96), { edge: 128, width: 96, height: 96 });
  assert.deepEqual(rasterSize(192,96), { edge: 128, width: 128, height: 64 });
  assert.deepEqual(rasterSize(512,256), { edge: 256, width: 256, height: 128 });
  assert.deepEqual(rasterSize(256,256), { edge: 256, width: 256, height: 256 });
});

test('denied permission and aborted jobs never fetch or overwrite previous icon', async () => {
  let value = 'old', fetched = 0;
  const effects = { cached: () => false, fetchIcon: async () => { fetched++; return 'new'; }, save: async (_, data) => { value = data; } };
  const c = new AbortController();
  assert.equal((await optimizeOne('https://example.com', false, effects, c.signal)).state, 'skipped');
  c.abort();
  assert.equal((await optimizeOne('https://example.com', true, effects, c.signal)).state, 'skipped');
  assert.equal(fetched, 0); assert.equal(value, 'old');
});

test('explicit cached selection retries, and failures preserve old value', async () => {
  let value = 'old', writes = 0, fetched = 0;
  const effects = { cached: () => false, fetchIcon: async () => { fetched++; throw new Error('network/decode failed'); }, save: async (_, data) => { writes++; value = data; } };
  const signal = new AbortController().signal;
  assert.equal((await optimizeOne('https://example.com', true, effects, signal)).state, 'failed');
  assert.equal(value, 'old'); assert.equal(writes, 0);
  effects.cached = () => true;
  assert.equal((await optimizeOne('https://example.com', true, effects, signal)).state, 'failed');
  assert.equal(fetched, 2); assert.equal(value, 'old');
  effects.cached = () => false; effects.fetchIcon = async () => 'validated-new';
  assert.equal((await optimizeOne('https://example.com', true, effects, signal)).state, 'success');
  assert.equal(value, 'validated-new'); assert.equal(writes, 1);
});

test('abort during fetch prevents save; storage failure is reported as failure', async () => {
  const c = new AbortController(); let writes = 0;
  const effects = { cached: () => false, fetchIcon: async () => { c.abort(); return 'new'; }, save: async () => { writes++; } };
  assert.equal((await optimizeOne('https://example.com', true, effects, c.signal)).state, 'skipped');
  assert.equal(writes, 0);
  effects.fetchIcon = async () => 'new'; effects.save = async () => { throw new Error('storage quota exceeded'); };
  assert.deepEqual(await optimizeOne('https://example.com', true, effects, new AbortController().signal), { state: 'failed', detail: 'storage quota exceeded' });
});

test('bounded fetch omits credentials/referrer, refuses redirects, enforces header and stream caps', async () => {
  const original = global.fetch; const signal = new AbortController().signal;
  try {
    let options;
    global.fetch = async (_, opts) => { options = opts; return new Response('ok', { headers: { 'content-type': 'image/png' } }); };
    assert.equal(await (await boundedFetch('https://example.com/', 2, signal)).text(), 'ok');
    assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.redirect, 'error'); assert.equal(options.signal, signal);
    global.fetch = async () => new Response('ok', { headers: { 'content-length': '1025' } });
    await assert.rejects(boundedFetch('https://example.com/', 1024, signal), /大小限制/);
    global.fetch = async () => new Response('12345');
    await assert.rejects(boundedFetch('https://example.com/', 4, signal), /大小限制/);
    global.fetch = async () => new Response('not found', { status: 404 });
    await assert.rejects(boundedFetch('https://example.com/', 1024, signal), /HTTP 404/);
    global.fetch = async () => { throw new Error('redirect rejected'); };
    await assert.rejects(boundedFetch('https://example.com/', 1024, signal), /redirect rejected/);
  } finally { global.fetch = original; }
});

function mockBrowser() {
  const event = () => { const listeners = new Set(); return { addListener: f => listeners.add(f), removeListener: f => listeners.delete(f), emit: (...args) => [...listeners].forEach(f => f(...args)), listeners }; };
  const pages = new Map([[999, { id: 999, url: 'https://unrelated.com/', status: 'complete' }]]), created = [], closed = [], scripts = [];
  const api = {
    permissions: { contains: async () => true },
    tabs: { onUpdated: event(), onRemoved: event(),
      create: async options => { const tab = { id: created.length + 1, url: options.url, status: 'complete' }; created.push(options); pages.set(tab.id, tab); return tab; },
      get: async id => { if (!pages.has(id)) throw new Error('No tab'); return pages.get(id); },
      remove: async id => { closed.push(id); pages.delete(id); api.tabs.onRemoved.emit(id); }
    },
    scripting: { executeScript: async options => { scripts.push(options); return [{ result: { origin: new URL(pages.get(options.target.tabId).url).origin, links: [{rel:'icon',href:'/icon.png'}] } }]; } }
  };
  return { api, pages, created, closed, scripts };
}
const sites = ['https://one.com', 'https://two.com', 'https://three.com'];
const effects = { fetchIcon: async () => 'validated', save: async () => {} };

test('permission grouping follows contains, independently of cache, and reflects revocation', async () => {
  let allowed = new Set([sites[1]]); const requests = [];
  const permissions = { contains: async request => { requests.push(request); return allowed.has(request.origins[0].slice(0, -2)); } };
  assert.deepEqual(await permissionGroups(sites, permissions), { pending: [sites[0], sites[2]], authorized: [sites[1]] });
  allowed.clear();
  assert.deepEqual((await permissionGroups(sites, permissions)).pending, sites);
  assert.deepEqual(requests[0], { origins: [sites[0] + '/*'] });
});

test('requestAccess calls request synchronously in original gesture and diagnoses stale manifest', async () => {
  let called = false;
  const api = {runtime:{getManifest:()=>({version:'1.4.0',optional_permissions:['scripting']})},permissions:{request:input=>{called=true;assert.deepEqual(input,{origins:[sites[0]+'/*'],permissions:['scripting']});return Promise.resolve(true)}}};
  const promise=requestAccess(api,[sites[0]]); assert.equal(called,true); assert.equal(await promise,true);
  api.runtime.getManifest=()=>({version:'1.3.0'});
  assert.throws(()=>requestAccess(api,[sites[0]]),/1.3.0.*未声明 scripting/);
});

test('permission rejection retains exact browser error, distinct from a false decision', async () => {
  const m=mockBrowser(),signal=new AbortController().signal;
  const rejected=await optimizeBatch(sites,Promise.reject(new Error('Must be called during a user gesture')),m.api,effects,signal);
  assert.equal(rejected.permissionIssue.kind,'error');assert.match(rejected.permissionIssue.message,/Must be called during a user gesture/);
  assert.match(rejected.results[0].detail,/Must be called during a user gesture/);
  const denied=await optimizeBatch(sites,false,m.api,effects,signal);
  assert.equal(denied.permissionIssue.kind,'denied');assert.match(denied.permissionIssue.message,/permissions.request = false/);
  assert.equal(m.created.length,0);
});

test('denied or rejected permission creates zero tabs', async () => {
  for (const permission of [Promise.resolve(false), Promise.reject(new Error('denied'))]) {
    const m = mockBrowser();
    const batch = await optimizeBatch(sites, permission, m.api, effects, new AbortController().signal);
    assert.equal(m.created.length, 0); assert.equal(batch.results.filter(r => r.state === 'skipped').length, 3);
  }
});

test('queue holds at most two root-only inactive tabs; save completes before success; only owned tabs closed', async () => {
  const m = mockBrowser(); let saves = 0;
  const batch = await optimizeBatch(sites, true, m.api, {
    fetchIcon: async (_, signal, links) => { assert.ok(m.pages.size - 1 <= 2); assert.equal(links[0].rel, 'icon'); return 'data'; },
    save: async () => { await new Promise(resolve => setTimeout(resolve, 5)); saves++; }
  }, new AbortController().signal);
  assert.equal(saves, 3); assert.equal(batch.results.filter(r => r.state === 'success').length, saves);
  assert.deepEqual(m.created, sites.map(origin => ({ url: origin + '/', active: false })));
  assert.deepEqual(m.closed.sort(), [1,2,3]); assert.ok(m.pages.has(999)); assert.deepEqual(batch.exceptions, []);
  assert.equal(m.api.tabs.onUpdated.listeners.size, 0); assert.equal(m.api.tabs.onRemoved.listeners.size, 0);
  assert.deepEqual(m.scripts[0].target.frameIds, [0]);
});

test('fetch and save failures close all owned tabs and never count success', async () => {
  for (const failing of [ { ...effects, fetchIcon: async () => { throw new Error('decode'); } }, { ...effects, save: async () => { throw new Error('quota'); } } ]) {
    const m = mockBrowser(); const batch = await optimizeBatch(sites, true, m.api, failing, new AbortController().signal);
    assert.equal(batch.results.filter(r => r.state === 'failed').length, 3); assert.equal(m.closed.length, 3);
  }
});

test('abort and hard timeout clean waiting tabs and listeners', async () => {
  for (const abort of [true, false]) {
    const m = mockBrowser(), c = new AbortController(); const create = m.api.tabs.create;
    m.api.tabs.create = async options => { const tab = await create(options); tab.status = 'loading'; return tab; };
    const pending = optimizeBatch(sites, true, m.api, effects, c.signal, { timeout: 30, loadTimeout: 20 });
    if (abort) setTimeout(() => c.abort(), 5);
    const batch = await pending;
    assert.equal(m.closed.length, abort ? 2 : 3); assert.equal(m.created.length, abort ? 2 : 3); assert.equal(batch.results.filter(r => r.state === (abort ? 'skipped' : 'failed')).length, 3);
    assert.equal(m.api.tabs.onUpdated.listeners.size, 0); assert.equal(m.api.tabs.onRemoved.listeners.size, 0);
  }
});

test('hung extraction aborts; creation failures do not prevent cleanup of siblings', async () => {
  const m = mockBrowser(), create = m.api.tabs.create;
  m.api.tabs.create = options => options.url === sites[1] + '/' ? Promise.reject(new Error('create failed')) : create(options);
  m.api.scripting.executeScript = () => new Promise(() => {});
  const batch = await optimizeBatch(sites, true, m.api, effects, new AbortController().signal, { timeout: 15 });
  assert.equal(batch.results.filter(r => r.state === 'failed').length, 3); assert.equal(m.closed.length, 2);
});

test('cross-origin navigation is neither injected nor closed, and close failures are disclosed', async () => {
  const m = mockBrowser(), create = m.api.tabs.create;
  m.api.tabs.create = async options => { const tab = await create(options); if (tab.id === 1) tab.url = 'https://different.com/'; return tab; };
  const remove = m.api.tabs.remove;
  m.api.tabs.remove = async id => { if (id === 2) throw new Error('close failed'); return remove(id); };
  const batch = await optimizeBatch(sites, true, m.api, effects, new AbortController().signal);
  assert.ok(m.pages.has(1)); assert.ok(m.pages.has(999)); assert.equal(m.scripts.some(s => s.target.tabId === 1), false);
  assert.equal(batch.exceptions.length, 2); assert.match(batch.exceptions.join(' '), /保留标签页/); assert.match(batch.exceptions.join(' '), /close failed/);
});

test('hidden destination after navigation is preserved rather than closing a possibly user-owned page', async () => {
  const m = mockBrowser();
  const batch = await optimizeBatch([sites[0]], true, m.api, {
    fetchIcon: async () => { delete m.pages.get(1).url; return 'data'; }, save: effects.save
  }, new AbortController().signal);
  assert.equal(m.closed.length, 0); assert.equal(batch.exceptions.length, 1); assert.match(batch.exceptions[0], /无法确认当前来源/);
});

test('permission revoked before injection prevents reading and user-closed tabs are not removed again', async () => {
  const m = mockBrowser(); m.api.permissions.contains = async () => false;
  const batch = await optimizeBatch([sites[0]], true, m.api, effects, new AbortController().signal);
  assert.equal(batch.results[0].state, 'failed'); assert.equal(m.scripts.length, 0); assert.equal(m.closed.length, 1);
  const n = mockBrowser(); const create = n.api.tabs.create;
  n.api.tabs.create = async options => {
    const tab = await create(options); tab.status = 'loading';
    setTimeout(() => { n.pages.delete(tab.id); n.api.tabs.onRemoved.emit(tab.id); }, 5); return tab;
  };
  const closed = await optimizeBatch([sites[0]], true, n.api, effects, new AbortController().signal);
  assert.equal(closed.results[0].state, 'failed'); assert.equal(n.closed.length, 0); assert.deepEqual(closed.exceptions, []);
});
