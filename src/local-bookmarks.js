/* Safari 本地书签库。 */
(() => {
  'use strict';
  const KEY = 'hubLocalBookmarksV1', VISITS = 'hubLocalVisitsV1';
  const clone = value => JSON.parse(JSON.stringify(value));
  const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function safeURL(value) {
    try { const u = new URL(value); return ['http:', 'https:', 'ftp:', 'mailto:'].includes(u.protocol) ? u.href : null; }
    catch (_) { return null; }
  }
  function parseHTML(text, Parser = globalThis.DOMParser, options = {}) {
    if (typeof text !== 'string' || text.length > 10 * 1024 * 1024) throw new Error('请选择不超过 10 MB 的书签 HTML 文件');
    // 解析前只保留书签结构和链接属性，防止导入文件加载外部资源。
    const sanitized = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, token => {
        const match = token.match(/^<\s*(\/?)\s*(dl|dt|a|h3|p)\b/i);
        if (!match) return '';
        if (match[1]) return '</' + match[2] + '>';
        if (match[2].toLowerCase() !== 'a') return '<' + match[2] + '>';
        const attribute = name => {
          const found = token.match(new RegExp('\\s' + name + '\\s*=\\s*("[^\"]*"|\'[^\']*\'|[^\\s>]+)', 'i'));
          return found ? ' ' + name + '=' + found[1] : '';
        };
        return '<a' + attribute('href') + attribute('add_date') + '>';
      });
    // Safari 26 的 HTML 导出包含多个顶层 H3/DL 分组，需要统一包裹。
    const doc = new Parser().parseFromString('<dl>' + sanitized + '</dl>', 'text/html');
    const list = doc.querySelector('dl');
    if (!list) throw new Error('文件中没有书签列表，请选择浏览器导出的书签 HTML');
    let count = 0, skipped = 0;
    // 兼容浏览器将 DL 修复为 DT 子节点或相邻节点的两种结构。
    function walk(dl, depth) {
      if (depth > 40) throw new Error('书签文件夹层级过深');
      const out = []; let lastFolder = null;
      for (const el of dl.children) {
        if (el.tagName === 'P') { out.push(...walk(el, depth)); continue; }
        if (el.tagName === 'DL') {
          const children = walk(el, depth + 1);
          if (lastFolder) lastFolder.children.push(...children); else out.push(...children);
          lastFolder = null; continue;
        }
        const entries = el.tagName === 'DT' ? [...el.children] : [el];
        for (const entry of entries) {
          if (entry.tagName === 'H3') {
            lastFolder = { title: entry.textContent.trim() || '未命名文件夹', children: [] };
            out.push(lastFolder); count++;
          } else if (entry.tagName === 'A') {
            const url = safeURL(entry.getAttribute('href'));
            if (url) {
              const seconds = Number(entry.getAttribute('add_date'));
              out.push({ title: entry.textContent.trim() || url, url,
                ...(options.sourceMetadata ? { sourceURL: entry.getAttribute('href'), sourceTitle: entry.textContent } : {}),
                dateAdded: seconds > 0 && Number.isFinite(seconds) ? seconds * 1000 : Date.now() }); count++;
            } else skipped++;
            lastFolder = null;
          } else if (entry.tagName === 'DL') {
            const children = walk(entry, depth + 1);
            if (lastFolder) lastFolder.children.push(...children); else out.push(...children);
            lastFolder = null;
          }
        }
        if (count > 50000) throw new Error('一次最多导入 50,000 个书签与文件夹');
      }
      return out;
    }
    const nodes = walk(list, 0);
    if (!count) throw new Error('文件中没有可导入的书签或文件夹');
    return { nodes, skipped };
  }
  function exportHTML(tree) {
    function lines(nodes, depth) {
      const indent = '    '.repeat(depth);
      return nodes.map(node => node.url
        ? `${indent}<DT><A HREF="${escapeHTML(node.url)}" ADD_DATE="${Math.floor((node.dateAdded || Date.now()) / 1000)}">${escapeHTML(node.title)}</A>`
        : `${indent}<DT><H3>${escapeHTML(node.title)}</H3>\n${indent}<DL><p>\n${lines(node.children || [], depth + 1)}\n${indent}</DL><p>`).join('\n');
    }
    return '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>bookmarknavigator 书签</TITLE>\n<H1>bookmarknavigator 书签</H1>\n<DL><p>\n' + lines(tree[0].children[0].children, 1) + '\n</DL><p>\n';
  }
  function event() {
    const listeners = new Set();
    return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn),
      emit: (...args) => listeners.forEach(fn => { try { fn(...args); } catch (e) { console.error(e); } }) };
  }
  function createLibrary(storage, options = {}) {
    const initial = () => ({ nextId: 1, root: { id: '0', title: '', children: [
      { id: 'local-bar', parentId: '0', title: '本地书签', folderType: 'bookmarks-bar', children: [] }
    ] } });
    const read = async () => { const data = await storage.get(KEY); return clone(data[KEY] || initial()); };
    function find(root, id) {
      if (root.id === String(id)) return root;
      for (const child of root.children || []) { const found = find(child, id); if (found) return found; }
      return null;
    }
    function need(data, id) { const node = find(data.root, id); if (!node) throw new Error('找不到书签或文件夹'); return node; }
    function folder(data, id) { const node = need(data, id); if (node.url) throw new Error('目标必须是文件夹'); return node; }
    function writable(data, id) { const node = need(data, id); if (node.id === '0' || node.parentId === '0') throw new Error('不能修改本地书签根目录'); return node; }
    function reindex(parent) { parent.children.forEach((node, index) => { node.index = index; node.parentId = parent.id; }); }
    function insert(parent, node, index) {
      if (index != null && (!Number.isInteger(index) || index < 0)) throw new Error('无效的书签顺序');
      parent.children.splice(index == null ? parent.children.length : Math.min(index, parent.children.length), 0, node); reindex(parent);
    }
    const events = { onCreated: event(), onChanged: event(), onRemoved: event(), onMoved: event() };
    let queue = Promise.resolve();
    function exclusive(fn) {
      const run = () => options.locks ? options.locks.request(KEY, fn) : fn();
      const result = queue.then(run); queue = result.catch(() => {}); return result;
    }
    function mutate(change) {
      return exclusive(async () => {
        const data = await read(), result = change(data);
        await storage.set({ [KEY]: data });
        events.onChanged.emit(result?.id || 'local-bar', {});
        return clone(result);
      });
    }
    function add(data, parent, entry, index) {
      const url = entry.url == null ? null : safeURL(entry.url);
      if (entry.url != null && !url) throw new Error('不支持此网址协议');
      const node = { id: 'local-' + data.nextId++, title: String(entry.title || ''), dateAdded: entry.dateAdded || Date.now(),
        ...(url ? { url } : { children: [] }) };
      insert(parent, node, index);
      for (const child of entry.children || []) add(data, node, child);
      return node;
    }
    const bookmarks = {
      ...events,
      getTree: async () => [(await read()).root],
      get: async ids => { const data = await read(); return (Array.isArray(ids) ? ids : [ids]).map(id => clone(need(data, id))); },
      getChildren: async id => clone(folder(await read(), id).children),
      getSubTree: async id => [clone(need(await read(), id))],
      create: details => mutate(data => add(data, folder(data, details.parentId || 'local-bar'), details, details.index)),
      update: (id, changes) => mutate(data => {
        const node = writable(data, id);
        if (changes.url != null) { const url = safeURL(changes.url); if (!node.url || !url) throw new Error('无效的书签网址'); node.url = url; }
        if (changes.title != null) node.title = String(changes.title);
        return node;
      }),
      move: (id, details) => mutate(data => {
        const node = writable(data, id), previous = folder(data, node.parentId);
        const parent = folder(data, details.parentId || node.parentId);
        if (find(node, parent.id)) throw new Error('不能把文件夹移入自身或子文件夹');
        previous.children.splice(previous.children.indexOf(node), 1); reindex(previous);
        insert(parent, node, details.index); return node;
      }),
      remove: id => mutate(data => {
        const node = writable(data, id);
        if (node.children?.length) throw new Error('不能删除非空文件夹');
        const parent = folder(data, node.parentId); parent.children.splice(parent.children.indexOf(node), 1); reindex(parent); return node;
      }),
      removeTree: id => mutate(data => {
        const node = writable(data, id), parent = folder(data, node.parentId);
        parent.children.splice(parent.children.indexOf(node), 1); reindex(parent); return node;
      })
    };
    return {
      bookmarks,
      importNodes: (nodes, title) => mutate(data => {
        const parent = folder(data, 'local-bar');
        const group = add(data, parent, { title: title || '导入的书签', children: nodes });
        return group;
      }),
      exportHTML: async () => exportHTML(await bookmarks.getTree()),
      history: { search: async () => { const data = await storage.get(VISITS); return Object.values(data[VISITS] || {}); } },
      recordVisit: url => exclusive(async () => {
        const safe = safeURL(url); if (!safe) return;
        const host = new URL(safe).host;
        const data = await storage.get(VISITS), visits = data[VISITS] || {};
        visits[host] = { url: safe, visitCount: (visits[host]?.visitCount || 0) + 1, lastVisitTime: Date.now() };
        const bounded = Object.fromEntries(Object.entries(visits).sort((a, b) => b[1].lastVisitTime - a[1].lastVisitTime).slice(0, 2000));
        await storage.set({ [VISITS]: bounded });
      })
    };
  }
  const helpers = { createLibrary, parseHTML, exportHTML, safeURL };
  if (typeof module !== 'undefined') module.exports = helpers;
  globalThis.HUB_LOCAL_BOOKMARKS = helpers;
})();
