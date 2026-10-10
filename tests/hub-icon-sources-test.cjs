'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { candidates, manifestIcons, sourceURL, safeSVG, fetchIcon, optimizeOne, optimizeBatch } = require('./../src/hires-icons.js');
const site = 'https://site.example.com', cdn = 'https://assets.example.com';
const signal = () => new AbortController().signal;
const missing = async () => { throw new Error('HTTP 404'); };
const failure = code => Object.assign(new Error(code), { code });

test('manifest resolves icons against manifest URL, rejects private URLs, bounds entries', () => {
  const icons = manifestIcons(JSON.stringify({ icons: [{ src: '../icons/large.png', sizes: '512x512' }, { src: cdn + '/vector', sizes: 'any' }, { src: 'http://127.0.0.1/a' }, { src: 'data:image/png,x' }] }), site + '/app/meta/site.webmanifest');
  assert.deepEqual(icons, [{ rel: 'icon', href: site + '/app/icons/large.png', sizes: '512x512' }, { rel: 'icon', href: cdn + '/vector', sizes: 'any' }]);
  assert.equal(manifestIcons(JSON.stringify({ icons: Array.from({ length: 100 }, (_, i) => ({ src: i + '.png' })) }), site + '/manifest').length, 24);
  assert.throws(() => manifestIcons('{', site));
  assert.equal(sourceURL('https://user:pass@assets.example.com/a', site), null);
});

test('expanded candidates stay bounded and cross origin requires an explicit exact source', () => {
  const links = Array.from({ length: 100 }, (_, i) => ({ rel: 'icon', href: '/' + i + '.png' }));
  assert.equal(candidates(site, links).length, 16);
  assert.ok(!candidates(site, [{ rel: 'icon', href: cdn + '/a.svg' }]).includes(cdn + '/a.svg'));
  assert.ok(candidates(site, [{ rel: 'icon', href: cdn + '/a.svg' }], new Set([site, cdn])).includes(cdn + '/a.svg'));
});

test('broad browser permission alone cannot fetch undisclosed CDN; explicit approval then works', async () => {
  const calls = [], discovered = [], links = [{ rel: 'icon', href: cdn + '/a', sizes: '512x512' }];
  const options = { hasPermission: async () => true, onSource: (...args) => discovered.push(args), fetch: async url => { calls.push(url); if (url.startsWith(cdn)) return new Blob(['png']); return missing(); }, decode: async () => 'data:image/png;base64,validated' };
  await assert.rejects(fetchIcon(site, signal(), links, options), { code: 'awaiting-permission' });
  assert.ok(calls.every(url => !url.startsWith(cdn))); assert.deepEqual(discovered, [[cdn, site]]);
  calls.length = 0;
  assert.equal(await fetchIcon(site, signal(), links, { ...options, approved: new Set([cdn]) }), 'data:image/png;base64,validated');
  assert.deepEqual(calls, [cdn + '/a']);
});

test('cross-origin manifest needs approval and newly discovered icon source waits for next approval', async () => {
  const extra = 'https://icons.example.com', calls = [];
  const options = { fetch: async (url, limit) => { calls.push(url); if (url === cdn + '/app/manifest.json') { assert.equal(limit, 131072); return new Blob([JSON.stringify({ icons: [{ src: extra + '/icon' }] })]); } if (url.startsWith(extra)) return new Blob(['png']); return missing(); }, decode: async () => 'png' };
  const links = [{ rel: 'manifest', href: cdn + '/app/manifest.json' }];
  await assert.rejects(fetchIcon(site, signal(), links, options), { code: 'awaiting-permission' });
  assert.ok(!calls.some(url => url.startsWith(cdn)));
  calls.length = 0;
  await assert.rejects(fetchIcon(site, signal(), links, { ...options, approved: [cdn] }), { code: 'awaiting-permission' });
  assert.ok(calls.includes(cdn + '/app/manifest.json')); assert.ok(!calls.some(url => url.startsWith(extra)));
  assert.equal(await fetchIcon(site, signal(), links, { ...options, approved: [cdn, extra] }), 'png');
});

test('same-origin manifest relative URL is used for fetching; manifest count bounded', async () => {
  const calls = [], links = [{ rel: 'manifest', href: '/p/site.json' }];
  const data = await fetchIcon(site, signal(), links, { fetch: async url => { calls.push(url); return url.endsWith('.json') ? new Blob(['{"icons":[{"src":"icons/a.png","sizes":"512x512"}]}']) : new Blob(['image']); }, decode: async () => 'validated' });
  assert.equal(data, 'validated'); assert.deepEqual(calls, [site + '/p/site.json', site + '/p/icons/a.png']);
  let manifests = 0;
  await assert.rejects(fetchIcon(site, signal(), Array.from({ length: 10 }, (_, i) => ({ rel: 'manifest', href: '/' + i + '.json' })), { fetch: async url => { if (url.endsWith('.json')) manifests++; return missing(); } }), { code: 'no-source' });
  assert.equal(manifests, 2);
});

test('low-resolution/no-source/network-failure/unsafe-svg remain distinguishable and never save', async () => {
  for (const code of ['low-resolution', 'no-source', 'network-failure', 'unsafe-svg']) {
    let writes = 0;
    const result = await optimizeOne(site, true, { fetchIcon: () => fetchIcon(site, signal(), [], { fetch: async () => new Blob(['x']), decode: async () => { throw failure(code); } }), save: async () => { writes++; } }, signal());
    assert.equal(result.reason, code); assert.equal(result.state, 'failed'); assert.equal(writes, 0);
  }
});

test('network failures do not incorrectly conclude that only low-resolution sources exist', async () => {
  await assert.rejects(fetchIcon(site, signal(), [{ rel: 'icon', href: '/small' }], {
    fetch: async url => { if (url.endsWith('/small')) return new Blob(['small']); throw new Error('network timeout'); },
    decode: async () => { throw failure('low-resolution'); }
  }), { code: 'network-failure' });
});

test('individual timeout leaves later candidates a chance', async () => {
  const calls = [];
  const result = await fetchIcon(site, signal(), [{ rel: 'icon', href: '/slow', sizes: '512x512' }, { rel: 'icon', href: '/good', sizes: '256x256' }], { candidateTimeout: 10, fetch: async url => { calls.push(url); if (url.endsWith('/slow')) return new Promise(() => {}); return new Blob(['png']); }, decode: async () => 'good' });
  assert.equal(result, 'good'); assert.deepEqual(calls, [site + '/slow', site + '/good']);
});

test('revoked approved source cannot download; permission denial batch performs zero effects', async () => {
  let downloads = 0;
  await assert.rejects(fetchIcon(site, signal(), [{ rel: 'icon', href: cdn + '/icon' }], { approved: [cdn], hasPermission: async () => false, fetch: async () => { downloads++; } }), { code: 'awaiting-permission' });
  const batch = await optimizeBatch([site], false, {}, { fetchIcon: async () => { downloads++; } }, signal());
  assert.equal(batch.results[0].state, 'skipped'); assert.equal(downloads, 0);
});

test('SVG entities, processing instructions and oversized input reject before parsing', () => {
  for (const text of ['<!DOCTYPE svg><svg/>', '<?evil x?><svg/>', '<!ENTITY x "x"><svg/>', 'x'.repeat(262145)]) assert.throws(() => safeSVG(text), { code: 'unsafe-svg' });
});

module.exports.svgFixtures = {
  good: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><defs><linearGradient id="g"><stop offset="0" stop-color="#777"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="16" height="16" fill="url(#g)"/></svg>',
  bad: ['<script/>', '<foreignObject/>', '<image href="data:image/png;base64,AAAA"/>', '<style>path{fill:red}</style>', '<use href="https://evil.example.com/a"/>', '<path fill="url(https://evil.example.com/a)"/>', '<path fill="u\\72l(https://evil.example.com/a)"/>', '<path style="fill:red"/>', '<path onload="alert(1)"/>'].map(part => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' + part + '</svg>')
};
