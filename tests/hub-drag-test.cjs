'use strict';
const assert = require('node:assert/strict');
const { moveIndex, reorderFavorites } = require('./../src/drag.js');
let cases = 0;
// 模拟 Chrome 在移除源节点前计算落点索引的规则。
function chromeMove(ids, source, index) {
  if (index == null) return ids.slice();
  const old = ids.indexOf(source);
  const result = ids.filter(id => id !== source);
  result.splice(index - (old >= 0 && old < index ? 1 : 0), 0, source);
  return result;
}
function desired(ids, source, target, after) {
  if (source === target) return ids.slice();
  const result = ids.filter(id => id !== source);
  const at = target == null ? result.length : result.indexOf(target) + Number(after);
  result.splice(at, 0, source);
  return result;
}
for (let size = 1; size <= 12; size++) {
  const ids = Array.from({ length: size }, (_, i) => String(i));
  // 真实索引包含文件夹和未显示的书签。
  const children = ids.map((id, i) => i % 3 === 0 ? { id } : { id, url: `https://example.test/${id}` });
  for (const source of [...ids, 'external-folder-bookmark']) {
    for (const target of [...ids, null]) {
      for (const after of [false, true]) {
        const index = moveIndex(children, source, target, after);
        assert.deepEqual(chromeMove(ids, source, index), desired(ids, source, target, after));
        cases++;
        if (source !== 'external-folder-bookmark') {
          assert.deepEqual(reorderFavorites(ids, source, target, after), desired(ids, source, target, after));
          cases++;
        }
      }
    }
  }
}
const nodes = ['a', 'folder', 'b', 'c'].map(id => ({ id }));
assert.equal(moveIndex(nodes, 'a', 'b', false), 2);
assert.equal(moveIndex(nodes, 'a', 'b', true), 3);
assert.equal(moveIndex(nodes, 'a', null, false), 4);
assert.equal(moveIndex(nodes, 'b', 'c', false), null);
assert.equal(moveIndex(nodes, 'c', 'b', true), null);
assert.equal(moveIndex([], 'source', null, false), 0);
assert.throws(() => moveIndex(nodes, 'a', 'missing', false));
assert.throws(() => reorderFavorites(['a', 'b'], 'missing', 'b', false));
assert.throws(() => reorderFavorites(['a', 'b'], 'a', 'missing', false));
const favorites = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
assert.deepEqual(reorderFavorites(favorites, 'a', null, false), ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'a']);
assert.deepEqual(favorites, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
cases += 11;
console.log(`PASS: ${cases} pure index/favorites assertions; no browser or real bookmark API invoked.`);
