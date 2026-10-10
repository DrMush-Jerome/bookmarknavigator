/* Safari 原生同步接口。 */
(() => {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  function signal() {
    const listeners = new Set();
    return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn),
      emit: (...args) => listeners.forEach(fn => fn(...args)) };
  }
  async function treeFromHTML(html, firstSeen, now, parser = globalThis.HUB_LOCAL_BOOKMARKS.parseHTML) {
    const { nodes } = parser(html, globalThis.DOMParser, { sourceMetadata: true });
    const root = { id: '0', title: '', children: [{ id: 'safari-bar', parentId: '0',
      title: 'Safari 书签', folderType: 'bookmarks-bar', children: [] }] };
    async function append(entries, parent, path) {
      const occurrences = new Map();
      for (const entry of entries) {
        const key = JSON.stringify([entry.title, entry.sourceURL || entry.url || null]);
        const occurrence = occurrences.get(key) || 0; occurrences.set(key, occurrence + 1);
        const identity = JSON.stringify([...path, [key, occurrence]]);
        const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
        const id = 'safari-' + [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('');
        // Safari 导出不含 ADD_DATE，以首次同步时间记录新增顺序。
        firstSeen[id] ||= now;
        const node = { ...entry, id, parentId: parent.id, index: parent.children.length, dateAdded: firstSeen[id] };
        parent.children.push(node);
        if (!entry.url) { node.children = []; await append(entry.children || [], node, [...path, [key, occurrence]]); }
      }
    }
    await append(nodes, root.children[0], []);
    return [root];
  }
  function create(api, local, options = {}) {
    let state = { enabled: false }, tree = null, treeDigest = null, transportError = '', reading = null;
    const events = { onCreated: signal(), onChanged: signal(), onRemoved: signal(), onMoved: signal() };
    const send = options.send || (message => api.runtime.sendNativeMessage('com.drmush.bookmarknavigator', message));
    const wait = options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const buildTree = options.buildTree || treeFromHTML;
    const listeners = new Set();
    let deleting = false;
    function notify() { listeners.forEach(fn => fn(status())); }
    function status() { return { ...state, active: !!state.enabled, hasSnapshot: !!tree, transportError }; }
    async function read() {
      if (reading) return reading;
      reading = (async () => {
        try {
          const next = await send({ action: 'snapshot' });
          if (!next?.ok) throw new Error(next?.error || '无法连接原生助手');
          const wasEnabled = !!state.enabled, previous = state.digest;
          // 助手连接失败时保留数据源身份，避免删除落入本地导入库。
          transportError = ''; state = next;
          if (next.enabled && next.html && (!tree || treeDigest !== next.digest)) {
            const data = await api.storage.local.get('hubSafariFirstSeenV1');
            const seen = data.hubSafariFirstSeenV1 || {};
            const candidate = await buildTree(next.html, seen, next.updatedAt || Date.now());
            const ids = new Set();
            const walk = node => { ids.add(node.id); (node.children || []).forEach(walk); }; candidate.forEach(walk);
            await api.storage.local.set({ hubSafariFirstSeenV1: Object.fromEntries(Object.entries(seen).filter(([id]) => ids.has(id))) });
            tree = candidate; treeDigest = next.digest;
          }
          if (wasEnabled !== !!state.enabled || previous !== state.digest) events.onChanged.emit('safari-bar', {});
        } catch (error) { transportError = error.message || String(error); }
        finally { notify(); }
        return status();
      })();
      try { return await reading; } finally { reading = null; }
    }
    function find(id) {
      const walk = node => node.id === String(id) ? node : (node.children || []).map(walk).find(Boolean);
      return tree?.map(walk).find(Boolean);
    }
    function need(id) { const node = find(id); if (!node) throw new Error('找不到 Safari 快照里的书签'); return node; }
    function writable() {
      if (transportError || !state.running) throw new Error('Safari 原生助手未运行或连接失败；原书签未改动');
      if (state.busy) throw new Error('Safari 正在同步，请完成后重试');
      if (state.error) throw new Error(state.error);
    }
    async function mutation(method, args) {
      await read();
      if (!state.enabled) return local.bookmarks[method](...args);
      writable();
      throw new Error('Safari 同步模式暂不支持编辑、移动、创建或自动还原；请在 Safari 中操作');
    }
    const bookmarks = {
      ...events,
      getTree: async () => {
        await read();
        if (!state.enabled) return local.bookmarks.getTree();
        if (!tree) throw new Error(transportError || state.error || '请在原生助手中完成首次同步');
        return copy(tree);
      },
      get: async ids => { await read(); return state.enabled ? (Array.isArray(ids) ? ids : [ids]).map(id => copy(need(id))) : local.bookmarks.get(ids); },
      getChildren: async id => { await read(); return state.enabled ? copy(need(id).children || []) : local.bookmarks.getChildren(id); },
      getSubTree: async id => { await read(); return state.enabled ? [copy(need(id))] : local.bookmarks.getSubTree(id); },
      create: (...args) => mutation('create', args), update: (...args) => mutation('update', args),
      move: (...args) => mutation('move', args), removeTree: (...args) => mutation('removeTree', args),
      remove: async id => {
        // 书签 ID 决定数据源，切换模式不改变操作对象。
        if (!String(id).startsWith('safari-')) {
          await read();
          if (state.enabled) throw new Error('书签数据源已切换，请刷新后重新选择');
          return local.bookmarks.remove(id);
        }
        await read();
        if (!state.enabled) throw new Error('Safari 同步已关闭，请重新加载后操作');
        writable();
        if (deleting) throw new Error('已有 Safari 删除请求等待处理');
        const node = need(id); if (!node.url) throw new Error('Safari 同步模式不支持删除文件夹');
        let duplicates = 0;
        const title = node.sourceTitle ?? node.title, url = node.sourceURL ?? node.url;
        const count = current => {
          if (current.url && (current.sourceTitle ?? current.title) === title && (current.sourceURL ?? current.url) === url) duplicates++;
          (current.children || []).forEach(count);
        }; tree.forEach(count);
        if (duplicates !== 1) throw new Error('存在同名同网址书签，请在 Safari 中核对后删除');
        deleting = true;
        try {
          const reply = await send({ action: 'delete', title, url, digest: state.digest });
          if (!reply?.ok || !reply.job) throw new Error(reply?.error || '无法提交 Safari 删除请求');
          // 导出可能等待系统验证，以助手状态和最终结果判断删除是否完成。
          for (let attempt = 0; ; attempt++) {
            await wait(1000);
            const result = await send({ action: 'result', job: reply.job });
            if (result?.pending) {
              if (attempt % 15 === 0) {
                await read();
                if (transportError || !state.running || (attempt >= 15 && !state.busy))
                  throw new Error('Safari 助手未返回删除结果，结果尚未确认；请检查助手与 Safari，勿重复提交');
              }
              continue;
            }
            await read();
            if (!result?.ok) {
              const error = new Error(result?.error || 'Safari 删除失败');
              error.safariDeleted = !!result?.deleted; throw error;
            }
            events.onRemoved.emit(id, {}); return;
          }
        } finally { deleting = false; }
      }
    };
    for (const name of Object.keys(events)) local.bookmarks[name].addListener((...args) => { if (!state.enabled) events[name].emit(...args); });
    return { bookmarks, status, read, addStatusListener: fn => listeners.add(fn),
      start: () => { read(); return setInterval(() => { if (!globalThis.document?.hidden) read(); }, 3000); } };
  }
  const exports = { create, treeFromHTML };
  globalThis.HUB_SAFARI_SYNC_MODULE = exports;
  if (typeof module !== 'undefined') module.exports = exports;
})();
