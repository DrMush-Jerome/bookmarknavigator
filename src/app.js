/* 书签数据与访问频率 */
/* CATS 使用文件夹 ID 标识分类；@frequent 为虚拟聚合视图。 */

const FREQUENT_KEY = '@frequent';
const BAR_TITLE = /书签栏|Bookmarks bar|Bookmarks Bar/i;

/* compat.js 负责选择当前浏览器的扩展 API。 */
const HUB_API = globalThis.HUB_API || null;
const LOCAL_LIBRARY = !!globalThis.HUB_LOCAL_LIBRARY;
let BOOKMARK_SOURCE = LOCAL_LIBRARY ? '导航台本地书签库' : '浏览器书签';
const EXT = !!HUB_API && !!HUB_API.bookmarks && !!HUB_API.storage && !!HUB_API.storage.local;
const extCall = (obj, method, ...args) => {
  if (!EXT || !obj || typeof obj[method] !== 'function') {
    return Promise.reject(new Error('当前环境不支持扩展 API'));
  }
  return obj[method](...args);
};

let CATS = [];
const FREQ = new Map();

const PALETTE = ['#e8734a','#4a8fe8','#4ab98f','#a86ae8','#e8b44a','#e85c8a','#4ac9d8','#7a86a8','#d95f4a','#5f8f4a'];
function colorFor(host) {
  let s = 0;
  for (let i = 0; i < host.length; i++) s = (s * 31 + host.charCodeAt(i)) >>> 0;
  return PALETTE[s % PALETTE.length];
}
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch (e) { return String(url || ''); }
}

function mkItem(node) {
  const h = hostOf(node.url);
  return { id: node.id, n: node.title || h || node.url, url: node.url, h, c: colorFor(h), freq: 0, addedAt: node.dateAdded || 0 };
}

/* 同网址书签按节点 ID 区分，保留各文件夹的直属书签。 */
function collectFolders(node, out, depth, parents = []) {
  if (node.url) return;
  const children = node.children || [];
  const name = node.title || '未命名';
  const path = parents.concat(name);
  out.push({
    key: node.id, folderId: node.id, name, path: path.join(' / '), depth,
    items: children.filter(c => c.url).map(mkItem)
  });
  children.filter(c => !c.url).forEach(c => collectFolders(c, out, depth + 1, path));
}

let bookmarkBarId = null;
function buildCats(tree) {
  const out = [];
  const roots = (tree || []).flatMap(root => root.children || []);
  const bar = roots.find(r => r.folderType === 'bookmarks-bar')
    || roots.find(r => !r.url && BAR_TITLE.test(r.title || ''));
  bookmarkBarId = bar ? bar.id : null;
  (tree || []).forEach(root => {
    const children = root.children || [];
    const direct = children.filter(c => c.url);
    if (direct.length) out.push({ key: root.id, folderId: root.id,
      name: root.title || '未分组书签', path: root.title || '未分组书签',
      depth: 0, items: direct.map(mkItem) });
    children.filter(c => !c.url).forEach(c => collectFolders(c, out, 0));
  });
  const counts = new Map();
  out.forEach(c => counts.set(c.name, (counts.get(c.name) || 0) + 1));
  out.forEach(c => { if (counts.get(c.name) > 1) c.name = c.path; });
  return out;
}

/* 最常访问按 URL 去重。 */
function frequentCat() {
  const seen = new Set(), items = [];
  CATS.forEach(c => c.items.forEach(it => {
    if (seen.has(it.url)) return;
    seen.add(it.url); items.push(it);
  }));
  return { key: FREQUENT_KEY, folderId: null, name: '最常访问', virtual: true, items };
}

/* 分类 */
const UNCATEGORIZED_KEY = '@auto:__none__';
const autoMode = () => CFG.categoryMode === 'auto';
/* 手动归属优先，其次按完整主机名和主域匹配。 */
function autoCategoryOf(item) {
  const override = CFG.categoryOverrides && CFG.categoryOverrides[item.id];
  if (override) return override;
  const map = globalThis.SITE_CATEGORY_MAP || {};
  const order = globalThis.SITE_CATEGORY_ORDER || [];
  const parts = String(item.h || '').split('.');
  const candidates = [item.h];
  if (parts.length > 2) candidates.push(parts.slice(-2).join('.'));
  for (const host of candidates) {
    const name = map[host];
    if (name && order.includes(name)) return '@auto:' + name;
  }
  return UNCATEGORIZED_KEY;
}
function applyAutoOrder(key, items) {
  const order = CFG.autoOrder && CFG.autoOrder[key];
  if (!Array.isArray(order) || !order.length) return items;
  const byId = new Map(items.map(i => [i.id, i]));
  const out = order.map(id => byId.get(id)).filter(Boolean);
  const done = new Set(out.map(i => i.id));
  for (const it of items) if (!done.has(it.id)) out.push(it);
  return out;
}
function deriveAutoCats(source) {
  const order = (globalThis.SITE_CATEGORY_ORDER || []).slice();
  const buckets = new Map(order.map(n => ['@auto:' + n, []]));
  buckets.set(UNCATEGORIZED_KEY, []);
  const seen = new Set();
  for (const cat of source) for (const item of cat.items) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    const key = autoCategoryOf(item);
    const bucket = buckets.get(key) || buckets.get(UNCATEGORIZED_KEY);
    bucket.push(item);
  }
  const out = [];
  for (const name of order) {
    const items = buckets.get('@auto:' + name);
    if (items.length) out.push({ key: '@auto:' + name, folderId: null, name, auto: true, items: applyAutoOrder('@auto:' + name, items) });
  }
  const none = buckets.get(UNCATEGORIZED_KEY);
  if (none.length) out.push({ key: UNCATEGORIZED_KEY, folderId: null, name: '未分类书签', auto: true, items: applyAutoOrder(UNCATEGORIZED_KEY, none) });
  return out;
}
let RAW_CATS = [];
function rebuildCats() {
  /* 隐藏只影响展示，RAW_CATS 保留完整书签树。 */
  const source = RAW_CATS.map(c => ({ ...c, items: c.items.filter(it => !isItemHidden(it)) }));
  CATS = autoMode() ? deriveAutoCats(source) : source;
}
function readCats(tree) { RAW_CATS = buildCats(tree); rebuildCats(); }
/* 文件夹和自动分类分别保存排序。 */
const orderField = () => (autoMode() ? 'autoCatOrder' : 'order');
const currentOrder = () => (Array.isArray(CFG[orderField()]) ? CFG[orderField()] : []);

function sortByFreq(cat) {
  cat.items.sort((a, b) => b.freq - a.freq);
  return cat;
}

async function loadFrequency() {
  try {
    const raw = await extCall(HUB_API.history, 'search', { text: '', maxResults: 100000, startTime: 0 });
    FREQ.clear();
    for (const v of raw) {
      const h = hostOf(v.url);
      FREQ.set(h, (FREQ.get(h) || 0) + (v.visitCount || 1));
    }
  } catch (e) {
    console.error('[history]', e);
  }
}

/* 配置 */
const DEFAULTS = { theme: 'auto', city: '北京', order: null, hidden: [], removed: [],
  hiddenItems: [], favoriteHiddenIds: [], trash: [],
  favCount: 6, recentCount: 5, folderCount: 6,
  showFavorites: true, showRecent: true, showFolders: true, showCalendar: true, showWeather: true,
  homeSections: ['recent', 'folders', 'calendar'], todos: {},
  categoryMode: 'folders', categoryOverrides: {}, autoOrder: {}, sortBy: 'custom',
  legalAccepted: false };
let CFG = Object.assign({}, DEFAULTS);

const cfgReady = extCall(EXT ? HUB_API.storage.local : null, 'get', 'cfg')
  .then(r => { CFG = Object.assign({}, DEFAULTS, r && r.cfg ? r.cfg : {}); cleanTrash(false); })
  .catch(() => {});
function saveCfg() {
  if (!EXT) return Promise.resolve();
  return HUB_API.storage.local.set({ cfg: CFG }).catch(e => console.error('[storage]', e));
}
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
function hiddenBookmarkRecords() {
  const raw = Array.isArray(CFG.hiddenItems) ? CFG.hiddenItems : [];
  return raw.map(v => typeof v === 'string' ? { id: v, title: '隐藏书签', url: '', hiddenAt: 0 } : v)
    .filter(v => v && v.id != null);
}
function hiddenBookmarkIds() { return new Set(hiddenBookmarkRecords().map(v => String(v.id))); }
function isItemHidden(item) { return !!item && hiddenBookmarkIds().has(String(item.id)); }
function cleanTrash(shouldSave = true) {
  const now = Date.now();
  const raw = Array.isArray(CFG.trash) ? CFG.trash : [];
  const next = raw.filter(v => v && v.id != null && Number(v.deletedAt) > 0 && now - Number(v.deletedAt) < TRASH_RETENTION_MS);
  CFG.trash = next;
  if (shouldSave && next.length !== raw.length) saveCfg();
  return next;
}

const ICON = {
  home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7"/><path d="M5 9v11h5v-6h4v6h5V9"/></svg>',
  all:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  常用:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.6 5.6 6.4.8-4.7 4.3 1.2 6.3L12 17l-5.5 3 1.2-6.3L3 9.4l6.4-.8L12 3Z"/></svg>',
  开发:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/></svg>',
  设计:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="19" cy="13" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="10" cy="19" r="2.5"/><path d="M12 2a10 10 0 1 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.6-1.4-.3-.4-.4-.8-.4-1.2a2 2 0 0 1 2-2h2a5 5 0 0 0 5-5c0-4.4-4-8-9-8Z"/></svg>',
  阅读:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6s2-1 5-1 5 2 5 2v13s-2-1-5-1-5 1-5 1V6Zm10 1s2-1 5-1 5 1 5 1v13s-2-1-5-1-5 1-5 1V7Z"/></svg>',
  工具:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0 5 5l-9 9a2.8 2.8 0 0 1-4-4l9-9Z"/><path d="m18 3 3 3"/></svg>'
};
const CHEV = '<svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>';

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ini = n => esc((Array.from(String(n || '').trim())[0] || '?').toUpperCase());

const collapsed = new Set();
const $ = id => document.getElementById(id);
const navEl = $('nav'), contentEl = $('content');
document.querySelector('.search-shortcut').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
const VIEW_STATE_KEY = 'drmush-view-state-v1';
function readViewState() {
  try {
    const raw = sessionStorage.getItem(VIEW_STATE_KEY);
    const state = raw ? JSON.parse(raw) : null;
    return state && typeof state === 'object' ? state : {};
  } catch (_) { return {}; }
}
const initialViewState = readViewState();
let currentKey = typeof initialViewState.currentKey === 'string' ? initialViewState.currentKey : 'home';
let keyword = typeof initialViewState.keyword === 'string' ? initialViewState.keyword : '';
let folderPreviewKey = typeof initialViewState.folderPreviewKey === 'string' ? initialViewState.folderPreviewKey : null;
const parsedMonth = /^\d{4}-\d{2}$/.test(String(initialViewState.calendarMonth || ''))
  ? new Date(`${initialViewState.calendarMonth}-01T00:00:00`) : new Date();
const initialMonth = Number.isNaN(parsedMonth.getTime()) ? new Date() : parsedMonth;
let calendarMonth = new Date(initialMonth.getFullYear(), initialMonth.getMonth(), 1);
let calendarDayKey = /^\d{4}-\d{2}-\d{2}$/.test(String(initialViewState.calendarDayKey || ''))
  ? String(initialViewState.calendarDayKey) : null;
const initialScrollY = Number.isFinite(Number(initialViewState.scrollY)) ? Math.max(0, Number(initialViewState.scrollY)) : 0;
function saveViewState() {
  try {
    sessionStorage.setItem(VIEW_STATE_KEY, JSON.stringify({
      currentKey, keyword, folderPreviewKey, calendarDayKey,
      calendarMonth: `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, '0')}`,
      scrollY: Math.max(0, Math.round(window.scrollY || 0))
    }));
  } catch (_) {}
}
const masterCats = () => [sortByFreq(frequentCat())].concat(CATS);
const allCats = () => masterCats().filter(c => !(CFG.removed || []).includes(c.key));
const panelCats = () => CATS.filter(c => !(CFG.removed || []).includes(c.key));
const findCat = key => masterCats().find(c => c.key === key);
const findCatOf = item => CATS.find(c => c.items.includes(item));
const ICON_FALLBACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';
const catIcon = name => ICON[name] || ICON_FALLBACK;
function orderedCats() {
  const rest = allCats();
  const saved = currentOrder();
  if (!saved.length) return rest;
  const map = new Map(rest.map(c => [c.key, c]));
  const ordered = saved.map(k => map.get(k)).filter(Boolean);
  return ordered.length === rest.length ? ordered : rest;
}
function visibleCats() { return orderedCats().filter(c => !CFG.hidden.includes(c.key)); }
function initOrder() {
  const keys = allCats().map(c => c.key);
  const out = [];
  currentOrder().forEach(k => { if (keys.includes(k) && !out.includes(k)) out.push(k); });
  keys.forEach(k => { if (!out.includes(k)) out.push(k); });
  CFG[orderField()] = out;
}

function match(item) {
  if (!keyword) return true;
  const k = keyword.toLowerCase();
  return item.n.toLowerCase().includes(k) || item.h.toLowerCase().includes(k);
}

/* 图标优先级：自定义、缓存、内置、首字。 */
function bookmarkIconUrl(item) {
  return HubLogos.candidates(item, CFG)[0] || '';
}
function cardHtml(item) {
  const fav = bookmarkIconUrl(item);
  const ico = fav
    ? `<span class="ico" data-c="${item.c}" data-i="${ini(item.n)}"><img class="fav" src="${esc(fav)}" alt="" loading="lazy" draggable="false" style="visibility:hidden"></span>`
    : `<span class="ico" style="background:${item.c}">${ini(item.n)}</span>`;
  return `<a class="card" data-item-id="${esc(item.id)}" href="${esc(item.url)}" title="${esc(item.n)} — ${esc(item.h)}">
    ${ico}
    <span class="nm">${esc(item.n)}</span></a>`;
}

/* 将书签对象绑定到节点，避免同名书签导致误识别。 */
function logoTone(pixels) {
  let weight = 0, brightness = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    if (alpha < .15) continue;
    weight += alpha;
    brightness += (.2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]) * alpha / 255;
  }
  return weight ? (brightness / weight > .78 ? 'dark' : 'light') : 'neutral';
}
function logoFit(pixels, width, height, edge = 24) {
  // 实底方形图标使用同一圆角遮罩。
  if (!width || !height || Math.abs(width / height - 1) > .03) return 'inset';
  let opaque = 0, total = 0;
  for (let y = 0; y < edge; y++) for (let x = 0; x < edge; x++) {
    if (x !== 0 && y !== 0 && x !== edge - 1 && y !== edge - 1) continue;
    total++; if (pixels[(y * edge + x) * 4 + 3] >= 245) opaque++;
  }
  return opaque / total >= .95 ? 'tile' : 'inset';
}
function applyLogoBacking(img, ico) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 24;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 24, 24);
    const pixels = ctx.getImageData(0, 0, 24, 24).data;
    ico.dataset.logoTone = logoTone(pixels);
    ico.dataset.logoFit = logoFit(pixels, img.naturalWidth, img.naturalHeight);
    ico.style.removeProperty('background');
  } catch (_) {
    ico.dataset.logoTone = 'neutral';
    ico.dataset.logoFit = 'inset';
    ico.style.removeProperty('background');
  }
}
function bindCardRefs() {
  const items = new Map(CATS.flatMap(c => c.items.map(item => [item.id, item])));
  contentEl.querySelectorAll('.card[data-item-id]').forEach(el => {
    el._item = items.get(el.dataset.itemId);
    const ico = el.querySelector('.ico'), img = el.querySelector('.fav');
    if (ico && img) {
      const choices = el._item ? HubLogos.candidates(el._item, CFG) : [];
      let index = 0, finished = false;
      const fallback = () => {
        if (finished) return;
        if (++index < choices.length) { img.src = choices[index]; return; }
        finished = true;
        delete ico.dataset.logoTone;
        ico.style.background = ico.dataset.c;
        ico.textContent = ico.dataset.i;
      };
      const loaded = () => {
        if (finished) return;
        if (!HubLogos.validSize(img.naturalWidth, img.naturalHeight)) { fallback(); return; }
        applyLogoBacking(img, ico);
        img.style.visibility = 'visible';
      };
      img.addEventListener('error', fallback);
      img.addEventListener('load', loaded);
      if (img.complete) {
        if (img.naturalWidth) loaded();
        else fallback();
      }
    }
  });
}
function catOf(item) { const c = findCatOf(item); return c ? c.key : ''; }
function sourceCatOf(item) {
  return RAW_CATS.find(c => c.items.some(it => String(it.id) === String(item && item.id))) || findCatOf(item);
}
function itemOf(card) { return card && card._item ? card._item : null; }

let scrollIdleTimer = null;
function markScrolling() {
  const root = document.documentElement;
  root.classList.add('is-scrolling');
  clearTimeout(scrollIdleTimer);
  scrollIdleTimer = setTimeout(() => root.classList.remove('is-scrolling'), 1000);
}
addEventListener('scroll', () => { markScrolling(); saveViewState(); }, { capture: true, passive: true });

const openMenus = new Set();
function closeAllMenus(except) {
  for (const m of [...openMenus]) if (m !== except) m.close();
}
/* 菜单挂在 body 下，避开容器的 backdrop-filter 裁切。 */
function menuPick(options, value, onChange, ariaLabel) {
  const wrap = document.createElement('span');
  wrap.className = 'menu-pick';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'menu-btn';
  btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
  if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
  const label = document.createElement('span');
  const caret = document.createElement('span');
  caret.className = 'menu-caret'; caret.setAttribute('aria-hidden', 'true');
  btn.append(label, caret);
  const list = document.createElement('div');
  list.className = 'menu-list'; list.setAttribute('role', 'listbox'); list.hidden = true;
  let current = value;
  const paint = () => {
    const hit = options.find(o => o[0] === current);
    label.textContent = hit ? hit[1] : '';
    for (const el of list.children) {
      const on = el.dataset.value === String(current);
      el.classList.toggle('on', on);
      el.setAttribute('aria-selected', String(on));
    }
  };
  for (const [v, text] of options) {
    const item = document.createElement('button');
    item.type = 'button'; item.className = 'menu-item'; item.dataset.value = String(v);
    item.setAttribute('role', 'option');
    const name = document.createElement('span'); name.textContent = text;
    const check = document.createElement('span'); check.className = 'menu-check'; check.setAttribute('aria-hidden', 'true');
    item.append(name, check);
    item.addEventListener('click', () => { current = v; paint(); close(); onChange(current); });
    list.append(item);
  }
  function place() {
    const r = btn.getBoundingClientRect();
    const w = Math.max(r.width, 150);
    list.style.minWidth = w + 'px';
    list.style.left = Math.round(Math.min(Math.max(10, r.left), innerWidth - w - 10)) + 'px';
    const below = innerHeight - r.bottom;
    const h = Math.min(list.scrollHeight, 320);
    const top = below > h + 12 ? r.bottom + 6 : Math.max(10, r.top - h - 6);
    list.style.top = Math.round(top) + 'px';
    list.style.maxHeight = Math.max(120, Math.min(h, innerHeight - top - 10)) + 'px';
  }
  function open() {
    if (!list.hidden) return;
    closeAllMenus(api);
    list.hidden = false; btn.setAttribute('aria-expanded', 'true');
    openMenus.add(api); place();
    const active = list.querySelector('.menu-item.on') || list.firstElementChild;
    if (active) active.focus();
  }
  function close() {
    if (list.hidden) return;
    list.hidden = true; btn.setAttribute('aria-expanded', 'false');
    openMenus.delete(api);
  }
  const api = { open, close, el: wrap, sync: v => { current = v; paint(); } };
  btn.addEventListener('click', e => { e.stopPropagation(); list.hidden ? open() : close(); });
  btn.addEventListener('keydown', e => {
    if (['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); }
  });
  list.addEventListener('keydown', e => {
    const items = [...list.children];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); i <= 0 ? items[0]?.focus() : items[i - 1].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); items.at(-1)?.focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); btn.focus(); }
  });
  addEventListener('scroll', () => { if (!list.hidden) place(); }, true);
  addEventListener('resize', () => { if (!list.hidden) place(); });
  wrap.append(btn);
  document.body.append(list);
  paint();
  return api;
}
const menuRegistry = [];
function bindMenus() {
  for (const api of menuRegistry.splice(0)) api.close();
  for (const slot of document.querySelectorAll('[data-menu-sort]')) {
    const api = menuPick(SORT_OPTIONS, currentSort(), v => { CFG.sortBy = v; saveCfg(); render(); }, '书签排序方式');
    menuRegistry.push(api);
    slot.replaceWith(api.el);
  }
  for (const slot of document.querySelectorAll('[data-menu-time], [data-menu-hour]')) {
    const value = Number(slot.dataset.value || 0);
    const isEnd = slot.dataset.menuTime === 'end';
    const options = Array.from({ length: isEnd ? 49 : 48 }, (_, i) => [i * 30, todoTimeLabel(i * 30)]);
    const api = menuPick(options, value, v => {
      api.el.dataset.value = String(v);
    }, isEnd ? '待办结束时间' : '待办开始时间');
    ['data-menu-time', 'data-todo-start', 'data-todo-end', 'data-menu-hour'].forEach(attr => {
      if (slot.hasAttribute(attr)) api.el.setAttribute(attr, slot.getAttribute(attr) || '');
    });
    api.el.hidden = slot.hidden;
    api.el.dataset.value = String(value);
    menuRegistry.push(api);
    slot.replaceWith(api.el);
  }
}
document.addEventListener('click', e => { if (!e.target.closest('.menu-pick') && !e.target.closest('.menu-list')) closeAllMenus(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllMenus(); }, true);
function syncMenus() { for (const api of menuRegistry) api.sync(currentSort()); }

/* 网格排序只调整展示顺序。 */
const SORT_OPTIONS = [
  ['custom', '自定义顺序'],
  ['nameAsc', '名称 A → Z'],
  ['nameDesc', '名称 Z → A'],
  ['addedDesc', '最新添加'],
  ['addedAsc', '最早添加'],
];
const currentSort = () => (SORT_OPTIONS.some(o => o[0] === CFG.sortBy) ? CFG.sortBy : 'custom');
function sortItems(items) {
  const arr = items.slice();
  const by = currentSort();
  if (by === 'nameAsc') arr.sort((a, b) => String(a.n).localeCompare(String(b.n), 'zh-Hans-CN'));
  else if (by === 'nameDesc') arr.sort((a, b) => String(b.n).localeCompare(String(a.n), 'zh-Hans-CN'));
  else if (by === 'addedDesc') arr.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  else if (by === 'addedAsc') arr.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
  return arr;
}
function sortPickHtml() {
  return '<span data-menu-sort></span>';
}
function sortBarHtml(count, note) {
  return `<div class="grid-bar"><span class="hint-line">${esc(note || '')}${note ? ' · ' : ''}${count} 个</span><span class="sort-pick"><span>排序</span>${sortPickHtml()}</span></div>`;
}

function addedLabel(timestamp) {
  if (!timestamp) return '时间未知';
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
  return days === 0 ? '今天添加' : days < 7 ? `${days} 天前` : new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

const FAV_MIN = 4, FAV_MAX = 16, HOME_WIDGETS = ['recent', 'folders', 'calendar'];
const WIDGET_META = {
  recent: { name: '最近添加', hint: '按添加时间排列的书签列表', min: 3, max: 8 },
  folders: { name: '分类', hint: '点击分类预览书签，“全部”进入分类页', min: 2, max: 8 },
  calendar: { name: '待办事项', hint: '点击日期查看或添加当日待办', min: 0, max: 0 },
};
const clampInt = (value, lo, hi, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const favLimit = () => clampInt(CFG.favCount, FAV_MIN, FAV_MAX, 6);
const recentLimit = () => clampInt(CFG.recentCount, 3, 8, 5);
const folderLimit = () => clampInt(CFG.folderCount, 2, 8, 6);
function homeSections() {
  const list = Array.isArray(CFG.homeSections) ? CFG.homeSections.filter(k => HOME_WIDGETS.includes(k)) : [];
  for (const k of DEFAULTS.homeSections) if (!list.includes(k)) list.push(k);
  return list;
}
function sectionVisible(key) {
  return CFG['show' + key[0].toUpperCase() + key.slice(1)] !== false;
}
function favColumns(count) {
  return count <= 8 ? Math.max(4, count) : Math.min(8, Math.ceil(count / 2));
}

/* 月历与待办 */
const WEEK_CN = ['周日','周一','周二','周三','周四','周五','周六'];
const TODO_COLORS = ['#e8734a', '#e8b44a', '#4ab98f', '#4a8fe8', '#a86ae8', '#e85c8a'];
function todoKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function todosOn(key) {
  const list = CFG.todos && CFG.todos[key];
  return Array.isArray(list) ? list : [];
}
/* 兼容只保存 hour 的待办记录。 */
function todoTimeLabel(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n)) return '--:--';
  const safe = Math.max(0, Math.min(1440, Math.round(n)));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}
function todoStartMinutes(todo, fallbackHour = 0) {
  const start = Number(todo && todo.start);
  if (Number.isInteger(start) && start >= 0 && start <= 1439) return start;
  const hour = Number(todo && todo.hour);
  if (Number.isInteger(hour) && hour >= 0 && hour <= 23) return hour * 60;
  return Math.max(0, Math.min(23, fallbackHour)) * 60;
}
function todoEndMinutes(todo) {
  const end = Number(todo && todo.end);
  return Number.isInteger(end) && end >= 0 && end <= 1440 ? end : null;
}
function todoIsRange(todo) {
  const end = todoEndMinutes(todo), start = todoStartMinutes(todo);
  return todo && todo.mode === 'range' && end != null && end > start;
}
function todoHour(todo, fallback) {
  return Math.floor(todoStartMinutes(todo, fallback) / 60);
}
function todoTimeText(todo) {
  const start = todoStartMinutes(todo);
  return todoIsRange(todo) ? `${todoTimeLabel(start)}–${todoTimeLabel(todoEndMinutes(todo))}` : todoTimeLabel(start);
}
function todoDots(key) {
  const colors = [...new Set(todosOn(key).map(t => t.color || TODO_COLORS[0]))];
  if (!colors.length) return '';
  const picks = colors.length > 3
    ? [colors[0], colors[Math.floor((colors.length - 1) / 2)], colors[colors.length - 1]]
    : colors;
  return `<span class="day-dots" aria-hidden="true">${picks.map(c => `<i style="background:${esc(c)}"></i>`).join('')}</span>`;
}
function calendarHtml() {
  const month = `<div class="cal-month">${calendarMonthHtml()}</div>`;
  /* 宽卡片同时显示月视图和日视图；窄卡片按所选日期切换。 */
  const dayKey = calendarDayKey || todoKey(new Date());
  return `<div class="cal-body${calendarDayKey ? ' is-day' : ''}" data-cal-body>${month}${calendarDayHtml(dayKey)}</div>`;
}
function calendarMonthHtml() {
  const year = calendarMonth.getFullYear(), month = calendarMonth.getMonth();
  const today = new Date();
  const start = new Date(year, month, 1).getDay();
  const cells = Array.from({ length: 42 }, (_, i) => {
    const date = new Date(year, month, i - start + 1);
    const isToday = date.toDateString() === today.toDateString();
    const key = todoKey(date), count = todosOn(key).length;
    const label = `${date.getMonth() + 1} 月 ${date.getDate()} 日` + (count ? `，${count} 项待办` : '，无待办');
    return `<button type="button" class="day${date.getMonth() !== month ? ' outside' : ''}${isToday ? ' today' : ''}" data-date="${key}" aria-label="${esc(label)}"${isToday ? ' aria-current="date"' : ''}><span class="day-n">${date.getDate()}</span>${todoDots(key)}</button>`;
  }).join('');
  return `<div class="calendar-toolbar"><button class="text-action" data-month="-1" aria-label="上个月">‹</button><strong id="calendar-label">${year} 年 ${month + 1} 月</strong><button class="text-action" data-month="1" aria-label="下个月">›</button></div><div class="calendar-week">${['日','一','二','三','四','五','六'].map(d => `<span>${d}</span>`).join('')}</div><div class="calendar-days">${cells}</div>`;
}
function calendarDayHtml(key) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const isToday = date.toDateString() === new Date().toDateString();
  const nowHour = new Date().getHours();
  const start = (isToday ? nowHour : 9) * 60;
  const end = Math.min(1440, start + 60);
  const items = todosOn(key);
  const rows = Array.from({ length: 24 }, (_, h) => {
    const list = items.filter(t => todoHour(t, nowHour) === h);
    return `<div class="hour-row${h === nowHour && isToday ? ' is-now' : ''}" data-hour="${h}">
      <span class="hour-n">${String(h).padStart(2, '0')}:00</span>
      <div class="hour-items">${list.map(t => `<div class="todo-chip"><span class="todo-dot" style="background:${esc(t.color || TODO_COLORS[0])}"></span><span class="todo-copy"><span class="todo-time">${esc(todoTimeText(t))}</span><span class="todo-text">${esc(t.text)}</span></span><button class="todo-del" type="button" data-td-del="${esc(String(t.id))}" aria-label="删除该待办事项">×</button></div>`).join('')}</div>
    </div>`;
  }).join('');
  return `<div class="cal-day"><div class="calendar-toolbar"><button class="text-action" data-day-back>‹ 待办事项</button><strong id="calendar-label">${date.getMonth() + 1} 月 ${date.getDate()} 日 · ${WEEK_CN[date.getDay()]}</strong><span class="day-total">${items.length} 项</span></div>
    <div class="day-scroll" data-day-scroll>${rows}</div>
    <form class="day-add" data-day-form>
      <div class="day-add-toolbar">
        <div class="todo-mode" role="radiogroup" aria-label="待办时间类型">
          <button type="button" data-todo-mode="point" role="radio" aria-checked="true" class="on">时间点</button>
          <button type="button" data-todo-mode="range" role="radio" aria-checked="false">时间区间</button>
        </div>
        <div class="todo-time-fields" aria-label="待办时间">
          <span class="todo-time-label" data-todo-start-label>时间</span>
          <span data-menu-time="start" data-menu-hour data-todo-start data-value="${start}"></span>
          <span class="todo-range-sep" data-todo-range-sep hidden>至</span>
          <span data-menu-time="end" data-todo-end data-value="${end}" hidden></span>
        </div>
      </div>
      <div class="day-add-row day-add-options"><span class="day-add-caption">标记颜色</span>
        <div class="day-colors" role="radiogroup" aria-label="标记颜色">${TODO_COLORS.map((c, i) => `<button type="button" class="todo-color${i === 0 ? ' on' : ''}" data-c="${c}" style="background:${c}" role="radio" aria-checked="${i === 0}" aria-label="颜色 ${i + 1}"></button>`).join('')}</div></div>
      <div class="day-add-row"><input data-day-text type="text" maxlength="60" placeholder="添加待办事项" aria-label="待办内容"><button class="m-btn primary" type="submit">添加</button></div>
    </form></div>`;
}
function positionDayScroll(scroller, keepTop) {
  if (!scroller) return;
  if (keepTop != null) { scroller.scrollTop = keepTop; return; }
  const todayKey = todoKey(new Date()), dayKey = calendarDayKey || todayKey;
  const first = todosOn(dayKey)[0];
  const target = dayKey === todayKey ? new Date().getHours() : (first ? todoHour(first, 9) : 8);
  const row = scroller.querySelector(`.hour-row[data-hour="${target}"]`);
  if (row) scroller.scrollTop = Math.max(0, row.offsetTop - 6);
}
function renderCalendar(keepScroll) {
  const host = $('calendar-body');
  if (!host) return;
  const prev = host.querySelector('[data-day-scroll]');
  const prevTop = keepScroll && prev ? prev.scrollTop : null;
  host.innerHTML = calendarHtml();
  positionDayScroll(host.querySelector('[data-day-scroll]'), prevTop);
  bindCalendar();
  bindMenus();
  saveViewState();
}
function bindCalendar() {
  const host = $('calendar-body');
  if (!host) return;
  const form = host.querySelector('[data-day-form]');
  if (form) {
    let chosen = TODO_COLORS[0];
    let mode = 'point';
    const rangeSep = form.querySelector('[data-todo-range-sep]');
    const startLabel = form.querySelector('[data-todo-start-label]');
    const paintMode = next => {
      mode = next === 'range' ? 'range' : 'point';
      form.querySelectorAll('[data-todo-mode]').forEach(b => {
        const on = b.dataset.todoMode === mode;
        b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
      });
      const endPicker = form.querySelector('[data-todo-end]');
      if (endPicker) endPicker.hidden = mode !== 'range';
      if (rangeSep) rangeSep.hidden = mode !== 'range';
      if (startLabel) startLabel.textContent = mode === 'range' ? '开始' : '时间';
    };
    form.querySelectorAll('[data-todo-mode]').forEach(b => b.addEventListener('click', () => paintMode(b.dataset.todoMode)));
    host.querySelector('.day-colors').addEventListener('click', e => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      chosen = b.dataset.c;
      host.querySelectorAll('.todo-color').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const input = form.querySelector('[data-day-text]');
      const text = input.value.trim(); if (!text) return;
      const start = Number(form.querySelector('[data-todo-start]')?.dataset.value || 0);
      const end = Number(form.querySelector('[data-todo-end]')?.dataset.value || 0);
      if (mode === 'range' && end <= start) { toast('结束时间需要晚于开始时间'); return; }
      /* 未选日期时将待办保存到今天。 */
      const key = calendarDayKey || todoKey(new Date());
      const arr = todosOn(key).slice();
      const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, color: chosen, mode, start, hour: Math.floor(start / 60) };
      if (mode === 'range') item.end = end;
      arr.push(item);
      CFG.todos = Object.assign({}, CFG.todos, { [key]: arr });
      saveCfg(); input.value = ''; renderCalendar(true);
    });
    host.addEventListener('click', e => {
      const del = e.target.closest('[data-td-del]');
      if (!del) return;
      const key = calendarDayKey || todoKey(new Date());
      const arr = todosOn(key).filter(t => String(t.id) !== del.dataset.tdDel);
      if (arr.length) CFG.todos[key] = arr; else delete CFG.todos[key];
      saveCfg(); renderCalendar(true);
    });
  }
}
function getHomeFavorites() {
  const limit = favLimit();
  const excluded = new Set((CFG.favoriteHiddenIds || []).map(id => String(id)));
  if (Array.isArray(CFG.favoriteIds)) {
    const byId = new Map(CATS.flatMap(c => c.items).map(it => [it.id, it]));
    return sortItems([...new Set(CFG.favoriteIds)].map(id => byId.get(id)).filter(it => it && !excluded.has(String(it.id)))).slice(0, limit);
  }
  const seen = new Set();
  const picked = visibleCats().filter(c => !c.virtual).flatMap(c => c.items)
    .filter(item => {
      if (excluded.has(String(item.id)) || seen.has(item.url)) return false;
      seen.add(item.url); return true;
    }).sort((a, b) => b.freq - a.freq).slice(0, limit);
  return sortItems(picked);
}
/* 根据卡片可用区域计算预览网格的行列。 */
const FOLDER_PREVIEW_MAX = 24;
const FOLDER_PREVIEW_FIT = { gap: 10, colW: 72, rowH: 88, hintH: 34, maxCols: 8 };
/* 用离屏列表测量统一高度，避免列表与预览切换时跳动。 */
let folderCardHeight = 0, folderBodyBox = { w: 0, h: 0 }, lastFolderPreview = null;
function folderMotionAttr() {
  const now = folderPreviewKey;
  const motion = !now ? (lastFolderPreview ? 'back' : '') : (lastFolderPreview === now ? '' : 'in');
  lastFolderPreview = now;
  return motion ? ` data-folder-motion="${motion}"` : '';
}
function folderTilesHtml(folders) {
  return `<div class="folder-tiles">${folders.slice(0, folderLimit()).map(c => `<button class="folder-tile" type="button" data-folder-preview="${esc(c.key)}">${catIcon(c.name)}<span class="folder-copy"><strong>${esc(c.name)}</strong><small>${c.items.length} 个书签</small></span></button>`).join('') || '<p class="widget-empty">暂无分类</p>'}</div>`;
}
function folderHeadHtml() {
  return `<header class="widget-head"><h2>分类</h2><button class="text-action" data-settings type="button">管理 ›</button></header>`;
}
function readFolderBox(host) {
  const body = host.querySelector('.folders-body');
  return { w: body ? body.clientWidth : 0, h: body ? body.clientHeight : 0 };
}
function measureFolderCardHeight(folders) {
  const host = contentEl.querySelector('.folders-widget');
  if (!host) { folderCardHeight = 0; folderBodyBox = { w: 0, h: 0 }; return; }
  if (!folderPreviewKey) {
    const inline = host.style.minHeight;
    host.style.minHeight = '0px';
    folderCardHeight = Math.round(host.getBoundingClientRect().height);
    folderBodyBox = readFolderBox(host);
    host.style.minHeight = inline;
  } else {
    const width = Math.round(host.getBoundingClientRect().width);
    const probe = document.createElement('article');
    probe.className = 'widget folders-widget';
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;';
    probe.style.width = width + 'px';
    probe.innerHTML = `${folderHeadHtml()}<div class="folders-body">${folderTilesHtml(folders)}</div>`;
    document.body.append(probe);
    folderCardHeight = Math.round(probe.getBoundingClientRect().height);
    folderBodyBox = readFolderBox(probe);
    probe.remove();
  }
  host.style.minHeight = folderCardHeight ? folderCardHeight + 'px' : '';
}
function folderPreviewBox() {
  if (folderBodyBox.w > 0 && folderBodyBox.h > 0) return folderBodyBox;
  const width = contentEl.clientWidth > 0 ? contentEl.clientWidth : 900;
  return { w: Math.max(260, Math.min(560, Math.round(width / 3))), h: 300 };
}
function folderPreviewFit(box, total) {
  const { gap, colW, rowH, hintH, maxCols } = FOLDER_PREVIEW_FIT;
  const widthCols = Math.max(1, Math.min(maxCols, Math.floor((box.w + gap) / (colW + gap))));
  const rowsFor = h => Math.max(1, Math.floor((h + gap) / (rowH + gap)));
  let availRows = rowsFor(box.h);
  let cap = Math.min(total, FOLDER_PREVIEW_MAX, widthCols * availRows);
  // 先预留剩余数量提示的高度，再计算可显示的书签数量。
  if (cap < total && cap < FOLDER_PREVIEW_MAX) {
    availRows = rowsFor(box.h - hintH);
    cap = Math.min(total, FOLDER_PREVIEW_MAX, widthCols * availRows);
  }
  const finish = (cols, count) => ({ cols, count, row: rowH });
  if (!cap) return finish(widthCols, 0);
  let cols = Math.min(widthCols, cap);
  while (cols > 1 && Math.ceil(cap / cols) > availRows) cols--;
  const usedRows = Math.ceil(cap / cols);
  for (let c = cols; c >= 1; c--) {
    if (cap % c === 0 && Math.ceil(cap / c) === usedRows) return finish(c, cap);
  }
  // 避免末行只显示一个图标。
  const last = cap - (usedRows - 1) * cols;
  const count = usedRows > 1 && last <= 1 ? (usedRows - 1) * cols : cap;
  return finish(cols, Math.max(count, Math.min(cap, cols)));
}
let folderSizeTimer = null;
addEventListener('resize', () => {
  clearTimeout(folderSizeTimer);
  folderSizeTimer = setTimeout(repaintFoldersWidget, 160);
});
function repaintFoldersWidget() {
  const host = contentEl.querySelector('.folders-widget');
  if (!host || currentKey !== 'home' || keyword) return;
  const folders = visibleCats().filter(c => !c.virtual);
  if (!folders.length) return;
  const preview = folders.find(c => c.key === folderPreviewKey) || null;
  host.outerHTML = folderWidgetHtml(folders, preview);
  measureFolderCardHeight(folders);
  bindMenus();
}
function folderWidgetHtml(folders, preview) {
  if (!preview) return `<article class="widget folders-widget"${folderMotionAttr()}>${folderHeadHtml()}<div class="folders-body">${folderTilesHtml(folders)}</div></article>`;
  const fit = folderPreviewFit(folderPreviewBox(), preview.items.length);
  return `<article class="widget folders-widget folder-preview-widget"${folderMotionAttr()}><header class="widget-head"><div class="folder-preview-heading"><button class="text-action folder-preview-back" type="button" data-folder-back>‹ 分类</button><h2>${esc(preview.name)}</h2></div><div class="widget-actions"><button class="text-action" type="button" data-folder-all="${esc(preview.key)}">全部 <span aria-hidden="true">›</span></button><button class="text-action" data-settings>管理 ›</button></div></header><div class="folders-body">${folderPreviewHtml(preview, fit)}</div></article>`;
}
function folderPreviewHtml(cat, fit) {
  const items = sortItems(cat.items).slice(0, fit.count);
  const more = Math.max(0, cat.items.length - items.length);
  return items.length
    ? `<div class="folder-preview-grid" style="--fp-cols:${fit.cols};--fp-row:${fit.row}px">${items.map(cardHtml).join('')}</div>${more ? `<p class="folder-preview-more">还有 ${more} 个书签，点击右上角“全部”查看</p>` : ''}`
    : '<p class="widget-empty">这个分类还没有书签</p>';
}
function renderHome() {
  $('m-title').textContent = '开始今天的浏览';
  $('m-sub').textContent = '书签与常用网站，井然有序。';
  const folders = visibleCats().filter(c => !c.virtual);
  const items = folders.flatMap(c => c.items);
  const favorites = getHomeFavorites();
  const cols = favColumns(favorites.length ? Math.min(favLimit(), favorites.length) : favLimit());
  const dense = cols >= 7 ? ' data-dense="1"' : '';
  const recent = [...items].sort((a,b) => b.addedAt - a.addedAt).slice(0, recentLimit());
  const folderPreview = folders.find(c => c.key === folderPreviewKey) || null;
  const favSection = sectionVisible('favorites') ? `<section class="home-favorites">
    <header class="widget-head"><h2>常用书签</h2><div class="widget-actions">${sortPickHtml()}<button class="icon-btn favorite-add" data-favorites title="自定义常用书签" aria-label="自定义常用书签">+</button><button class="text-action" data-page-manage>页面管理 <span aria-hidden="true">›</span></button></div></header>
    <div class="grid" data-home-grid style="--fav-cols:${cols}"${dense}>${favorites.map(cardHtml).join('')}</div>
    ${favorites.length ? '' : '<p class="empty-tip">暂无可显示的书签，可在设置中检查分类显隐。</p>'}
  </section>` : '';
  const widgets = {
    recent: `<article class="widget recent-widget"><header class="widget-head"><h2>最近添加</h2><button class="text-action" data-go="@recent">查看全部 ›</button></header>
      <div class="recent-list">${recent.map(item => {
        const fav = bookmarkIconUrl(item);
        const icon = `<span class="ico" data-c="${item.c}" data-i="${ini(item.n)}" style="background:${item.c}">${fav ? `<img class="fav" src="${esc(fav)}" alt="" loading="lazy" draggable="false" style="visibility:hidden">` : ini(item.n)}</span>`;
        return `<a class="recent-item card" data-item-id="${esc(item.id)}" href="${esc(item.url)}" title="${esc(item.n)}"><span class="recent-icon">${icon}</span><span class="recent-copy"><strong>${esc(item.n)}</strong><small>${esc(item.h)}</small></span><time>${addedLabel(item.addedAt)}</time></a>`;
      }).join('') || '<p class="widget-empty">暂无书签</p>'}</div>
    </article>`,
    folders: folderWidgetHtml(folders, folderPreview),
    calendar: `<article class="widget calendar-widget"><header class="widget-head"><h2>待办事项</h2><button class="text-action" data-today>今天</button></header><div id="calendar-body">${calendarHtml()}</div></article>`,
  };
  const gridKeys = homeSections().filter(sectionVisible);
  const calCol = gridKeys.indexOf('calendar');
  const calAttr = gridKeys.length === 2 && calCol >= 0 ? ` data-cal="${calCol}"` : '';
  const emptyHint = (!favSection && !gridKeys.length) ? '<p class="empty-tip">首页模块已全部隐藏，可在「页面管理」中重新开启。</p>' : '';
  contentEl.innerHTML = favSection
    + (gridKeys.length ? `<div class="dashboard-grid" data-n="${gridKeys.length}"${calAttr}>${gridKeys.map(k => widgets[k]).join('')}</div>` : '')
    + emptyHint;
  bindCardRefs();
  bindCalendar();
  bindMenus();
  measureFolderCardHeight(folders);
  const calHost = $('calendar-body');
  if (calHost) positionDayScroll(calHost.querySelector('[data-day-scroll]'), null);
}

/* 页面渲染 */
function render() {
  if (!['home', 'all', '@recent'].includes(currentKey) && !findCat(currentKey)) currentKey = 'all';
  if (currentKey !== 'home') folderPreviewKey = null;
  saveViewState();
  initOrder();
  const vis = visibleCats();
  renderNav();

  if (currentKey === 'home' && !keyword) { renderHome(); return; }
  if (currentKey === '@recent') {
    const items = vis.filter(c => !c.virtual).flatMap(c => c.items).filter(match).sort((a,b) => b.addedAt - a.addedAt);
    $('m-title').textContent = '最近添加';
    $('m-sub').textContent = `共 ${items.length} 个 · 按添加时间排序`;
    contentEl.innerHTML = items.length ? sortBarHtml(items.length) + `<div class="grid">${sortItems(items).map(cardHtml).join('')}</div>` : '<p class="empty-tip">没有匹配的书签</p>';
    bindCardRefs(); bindMenus(); return;
  }
  if (currentKey === 'all' || currentKey === 'home') {
    $('m-title').textContent = keyword ? '搜索书签' : '全部书签';
    $('m-sub').textContent = '按分类分区 · 点击标题可折叠';
    const cats = vis.filter(c => !c.virtual && c.items.some(match));
    if (!cats.length) {
      contentEl.innerHTML = `<p class="empty-tip">${panelCats().length === 0 ? '所有分类均已移出面板，可在设置中添加' : '没有匹配的收藏项'}</p>`;
      return;
    }
    contentEl.innerHTML = cats.map(c => {
      const items = sortItems(c.items.filter(match));
      return `<section class="sec ${collapsed.has(c.key)?'collapsed':''}" data-key="${c.key}">
        <button class="sec-head" type="button">${CHEV}<span>${esc(c.name)}</span><span class="n">${items.length}</span></button>
        <div class="grid">${items.map(cardHtml).join('')}</div>
      </section>`;
    }).join('');
  } else {
    const cat = findCat(currentKey);
    $('m-title').textContent = cat ? cat.name : '全部';
    if (!cat) { currentKey = 'all'; return render(); }
    const items = cat.items.filter(match);
    const shown = sortItems(items);
    $('m-sub').textContent = `共 ${items.length} 个 · ${currentSort() === 'custom' ? (cat.virtual ? '按访问频率排序' : autoMode() ? '自动分类，可拖动调整顺序' : '直接拖动调整顺序') : SORT_OPTIONS.find(o => o[0] === currentSort())[1]}`;
    contentEl.innerHTML = items.length
      ? sortBarHtml(shown.length) + `<div class="grid">${shown.map(cardHtml).join('')}</div>`
      : `<p class="empty-tip">${cat.items.length ? '没有匹配的收藏项' : '这个分类还没有书签 — 右键任意书签即可移动进来'}</p>`;
  }
  bindCardRefs();
  bindMenus();
}

function renderNav() {
  const vis = new Set(visibleCats().map(c => c.key));
  const real = panelCats();
  const total = real.reduce((n, c) => n + c.items.length, 0);
  const items = [{ key: 'home', name: '主页', icon: 'home', n: '' }, { key: 'all', name: '全部书签', icon: 'all', n: total }, { key: '@recent', name: '最近添加', icon: '阅读', n: '' }]
    .concat(orderedCats().map(c => ({ key: c.key, name: c.name, icon: c.name, n: c.items.length, virtual: c.virtual })));
  navEl.innerHTML = items.map(c =>
    `<a href="#" data-key="${esc(c.key)}" class="${c.key === currentKey ? 'on' : ''}${!['home','all','@recent'].includes(c.key) && !vis.has(c.key) ? ' hidden-cat' : ''}">
      ${catIcon(c.icon)}<span>${esc(c.name)}</span><span class="n">${c.n}</span></a>`).join('');
  window.hubDecorateNav?.();
}

let searchTimer = null;
$('search').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { keyword = e.target.value.trim(); render(); }, 110);
});
document.addEventListener('keydown', e => {
  if (!$('legal-scrim').hidden) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
    return;
  }
  const editing = document.activeElement && document.activeElement.matches('input, textarea, [contenteditable="true"]');
  if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !editing)) { e.preventDefault(); $('search').focus(); }
  if (e.key === 'Escape') {
    closeCtx();
    const wp = $('wx-panel');
    if (!wp.hidden) { wp.hidden = true; $('search').blur(); return; }
    ['edit-scrim','move-scrim','addcat-scrim'].forEach(id => $(id).hidden = true);
    if (!$('set-drawer').hidden) closeSettings();
    else if (keyword) { keyword = ''; $('search').value = ''; render(); }
    $('search').blur();
  }
});

const mq = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const eff = CFG.theme === 'auto' ? (mq.matches ? 'dark' : 'light') : CFG.theme;
  document.documentElement.setAttribute('data-theme', eff);
  document.querySelectorAll('#st-theme button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.mode === CFG.theme)));
}
$('st-theme').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  CFG.theme = b.dataset.mode; saveCfg(); applyTheme();
});
mq.addEventListener?.('change', applyTheme);
applyTheme();

/* 天气 */
/* WMO 天气编码映射到 weather-icons.js 中的图标。 */

function pickIcon(code, isDay) {
  const k = (day, night) => isDay === false ? night : day;
  if (code === 0) return k('晴', '晴夜');
  if (code === 1) return k('局部多云', '多云夜');
  if (code === 2) return k('局部多云', '多云夜');
  if (code === 3) return '多云';
  if (code === 45 || code === 48) return '雾';
  if (code >= 51 && code <= 57) return '微雨';
  if (code === 61 || code === 80) return k('微雨', '微雨夜');
  if (code === 63 || code === 81) return '有雨';
  if (code === 65 || code === 82) return '暴雨';
  if (code === 66 || code === 67) return '雨夹雪';
  if (code === 71 || code === 73 || code === 77 || code === 85 || code === 86) return '下雪';
  if (code === 75) return '大雪';
  if (code === 95 || code === 96 || code === 99) return '雷暴雨';
  return '多云';
}

const ICON_LABEL = {
  '晴':'晴','局部多云':'局部多云','多云':'多云','雾':'雾','微雨':'微雨',
  '有雨':'有雨','暴雨':'暴雨','雨夹雪':'雨夹雪','下雪':'下雪','大雪':'大雪',
  '雷暴雨':'雷暴雨','晴夜':'夜间晴朗','多云夜':'夜间多云','微雨夜':'夜间有雨'
};

function iconHtml(key) {
  /* 缺失图标返回空字符串，天气数据仍可正常显示。 */
  const map = typeof APPLE_W === 'undefined' ? null : APPLE_W;
  const src = (map && map[key]) || (map && map['多云']);
  if (!src) return '';
  return `<img class="w-img" src="${src}" alt="${ICON_LABEL[key] || ''}" />`;
}

/* 为网络、权限和 CSP 导致的 fetch 失败补充错误说明。 */
async function fetchJSON(url, ms = 15000) {
  const endpoint = new URL(url);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    if (EXT && HUB_API.permissions) {
      const allowed = await HUB_API.permissions.contains({ origins: [endpoint.origin + '/*'] });
      if (!allowed) throw new Error('扩展未获得此站点访问权限，请在扩展详情中检查网站访问权限');
    }
    const r = await fetch(url, { signal: ac.signal, cache: 'no-store', credentials: 'omit' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    if (data.error) throw new Error(data.reason || '接口返回错误');
    return data;
  } catch (e) {
    const reason = e && e.name === 'AbortError' ? '请求超时（15 秒）'
      : (e && e.message) || '网络请求失败';
    throw new Error(`${endpoint.hostname}：${reason}`);
  } finally { clearTimeout(timer); }
}

/* 扩展使用 storage 缓存天气；独立预览使用 localStorage。 */
function cacheSet(obj) {
  try {
    if (EXT) { HUB_API.storage.local.set({ weather: obj }).catch(() => {}); return; }
    localStorage.setItem('hub-weather', JSON.stringify(obj));
  } catch (e) {}
}
async function cacheGet() {
  try {
    if (EXT) { const r = await HUB_API.storage.local.get('weather'); return (r && r.weather) || null; }
    const raw = localStorage.getItem('hub-weather');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function paintCapsule(label, temp, k, suffix) {
  $('w-city').textContent = label.length > 7 ? label.slice(0, 7) + '…' : label;
  $('w-temp').textContent = temp + '°';
  $('w-icon').innerHTML = iconHtml(k);
  $('weather').title = `${label} · ${temp}°C · ${ICON_LABEL[k] || k}${suffix || ''}`;
}

let weatherRequest = 0;
let weatherFailure = '';
async function loadWeather() {
  if (!CFG.legalAccepted || !CFG.showWeather) return;
  const request = ++weatherRequest;
  const city = CFG.city.trim();
  weatherFailure = '';
  const wEl = $('weather');
  wEl.classList.add('loading');
  wEl.title = '正在加载天气…';
  let stage = '城市查询';

  let place = null, payload = null, netErr = null;
  try {
    const saved = EXT ? await HUB_API.storage.local.get('weatherPlace') : {};
    if (saved.weatherPlace && saved.weatherPlace.city === city) place = saved.weatherPlace.place;
    if (!place && /^(北京|北京市|beijing)$/i.test(city)) {
      place = { name: '北京', latitude: 39.9075, longitude: 116.39723 };
    }
    if (!place) {
      const g = await fetchJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`);
      place = g.results && g.results[0];
    }
    if (!place) throw new Error('未找到城市「' + city + '」，请尝试不带市/区后缀的名称');
    if (EXT && request === weatherRequest) HUB_API.storage.local.set({ weatherPlace: { city, place } }).catch(() => {});
    stage = '天气预报';
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}`
      + `&current=temperature_2m,weather_code,is_day`
      + `&hourly=temperature_2m,weather_code,precipitation_probability,is_day`
      + `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max`
      + `&forecast_days=6&timezone=auto&forecast_hours=24`;
    payload = await fetchJSON(url);
  } catch (e) {
    netErr = e;
  }

  if (request !== weatherRequest) return;
  if (netErr) {
    weatherFailure = `${stage}失败\n${netErr.message || '未知错误'}\n城市：${city}\n扩展版本：${EXT ? HUB_API.runtime.getManifest().version : '网页预览'}\n\n请将此提示截图发给我定位原因。关闭提示后，再次打开新标签页可重试。`;
    const cached = await cacheGet();
    if (request !== weatherRequest) return;
    if (cached && cached.city === city) {
      try {
        paintCapsule(cached.label, cached.temp, cached.k, `（离线缓存：${new Date(cached.savedAt).toLocaleString()}；${stage}失败）`);
        if (cached.w) renderPanel(cached.w, cached.label);
        else $('wx-panel').hidden = true;
      } catch (e) { console.error('[weather] 缓存渲染失败', e); }
      wEl.classList.remove('loading');
      return;
    }
    $('w-city').textContent = stage === '城市查询' ? '城市查询失败' : '预报请求失败';
    $('w-temp').textContent = '--°';
    $('w-icon').innerHTML = iconHtml('多云');
    $('wx-panel').hidden = true;
    wEl.title = weatherFailure + '\n点击查看完整诊断';
    console.error('[weather]', netErr);
    wEl.classList.remove('loading');
    return;
  }

  try {
    const label = /[一-龥]/.test(CFG.city) ? place.name : `${place.name}${place.admin1 ? ', ' + place.admin1 : ''}`;
    const temp = Math.round(payload.current.temperature_2m);
    const k = pickIcon(payload.current.weather_code, payload.current.is_day !== 0);
    paintCapsule(label, temp, k);
    renderPanel(payload, label);
    cacheSet({ city, savedAt: Date.now(), label, temp, k, w: payload });
  } catch (e) {
    console.error('[weather] 渲染失败', e);
    weatherFailure = '天气数据渲染失败：' + (e && e.message ? e.message : '未知错误');
    wEl.title = weatherFailure;
  }
  wEl.classList.remove('loading');
}


function renderPanel(w, label) {
  $('p-city').textContent = label;
  $('p-temp').textContent = Math.round(w.current.temperature_2m) + '°';
  const k = pickIcon(w.current.weather_code, w.current.is_day !== 0);
  $('p-cond').textContent = ICON_LABEL[k] || k;

  const d = w.daily;
  const hi = Math.round(d.temperature_2m_max[0]);
  const lo = Math.round(d.temperature_2m_min[0]);
  $('p-hl').textContent = `${lo}°~${hi}°`;
  $('p-now-icon').innerHTML = iconHtml(k);

  const h = w.hourly;
  const nowIso = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 13);
  let start = h.time.findIndex(t => t.slice(0, 13) === nowIso);
  if (start < 0) start = 0;
  const hours = [];
  for (let i = start; i < Math.min(start + 12, h.time.length); i++) {
    const hh = Number(h.time[i].slice(11, 13));
    hours.push({
      label: i === start ? '现在' : String(hh).padStart(2, '0'),
      temp: Math.round(h.temperature_2m[i]),
      key: pickIcon(h.weather_code[i], h.is_day[i] !== 0)
    });
  }
  $('p-hours').innerHTML = hours.map(x =>
    `<div class="wx-h"><div class="hh">${x.label}</div>${iconHtml(x.key)}<div class="tt">${x.temp}°</div></div>`
  ).join('');

  const days = [];
  for (let i = 0; i < d.time.length; i++) {
    const dt = new Date(d.time[i] + 'T00:00:00');
    const name = i === 0 ? '今天' : (i === 1 ? '明天' : WEEK_CN[dt.getDay()]);
    days.push({
      name,
      key: pickIcon(d.weather_code[i], true),
      hi: Math.round(d.temperature_2m_max[i]),
      lo: Math.round(d.temperature_2m_min[i]),
      pc: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null
    });
  }
  $('p-days').innerHTML = days.map(x =>
    `<div class="wx-d">
      <span class="dw">${x.name}</span>
      ${iconHtml(x.key)}
      <span class="pc">${x.pc != null && x.pc > 0 ? x.pc + '%' : ''}</span>
      <span class="hi">${x.hi}°</span>
      <span class="lo">${x.lo}°</span>
    </div>`).join('');
}

const wxPanel = $('wx-panel');
function togglePanel(force) {
  if (!$('p-hours').children.length) { toast('天气数据加载中'); return; }
  const show = typeof force === 'boolean' ? force : wxPanel.hidden;
  if (show) positionPanel();
  wxPanel.hidden = !show;
}
/* 顶栏固定，页面滚动时需要重新计算浮层位置。 */
function positionPanel() {
  const r = $('weather').getBoundingClientRect();
  const w = wxPanel.offsetWidth || 324;
  const left = Math.min(Math.max(10, r.right - w), Math.max(10, innerWidth - w - 10));
  wxPanel.style.left = left + 'px';
  wxPanel.style.top = Math.round(r.bottom + 9) + 'px';
}
addEventListener('scroll', () => { if (!wxPanel.hidden) positionPanel(); });
addEventListener('resize', () => { if (!wxPanel.hidden) positionPanel(); });
$('weather').addEventListener('click', e => {
  e.stopPropagation();
  if (weatherFailure && !$('p-hours').children.length) {
    alert(weatherFailure);
    return;
  }
  togglePanel();
});
$('p-city').addEventListener('click', e => { e.stopPropagation(); showPanelCitySearch(); });
$('wx-search-back').addEventListener('click', e => { e.stopPropagation(); closePanelCitySearch(); });
$('wx-city-input').addEventListener('input', () => panelCitySearch());
$('wx-city-input').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Escape') { e.preventDefault(); closePanelCitySearch(); }
  if (e.key === 'Enter') {
    e.preventDefault();
    const first = $('wx-city-list').querySelector('.city-opt');
    if (first) first.click();
  }
});
document.addEventListener('click', e => {
  if (!e.target.closest('.wx-wrap') && !e.target.closest('.wx-panel')) wxPanel.hidden = true;
});

/* 设置 */
const drawer = $('set-drawer'), scrim = $('set-scrim');
const settingsTitle = $('set-title'), settingsBack = $('set-back'), settingsPages = $('set-pages');
let settingsPage = 'home', settingsDetailKey = '';
const SETTINGS_TITLES = { home: '设置', layout: '页面布局', bookmarks: '本地书签', icons: '网站图标', hidden: '隐藏书签', trash: '回收站', about: '关于导航台', 'about-detail': '' };
function renderSettingsPage() {
  const pageId = settingsPage === 'about-detail' ? 'st-about-detail-page' : `st-${settingsPage}-page`;
  drawer.querySelectorAll('.settings-page').forEach(page => { page.hidden = page.id !== pageId; });
  const isHome = settingsPage === 'home';
  const isAboutDetail = settingsPage === 'about-detail';
  settingsBack.hidden = isHome;
  settingsBack.classList.toggle('icon-only', isAboutDetail);
  settingsBack.setAttribute('aria-label', isAboutDetail ? '返回关于导航台' : '返回设置');
  settingsBack.querySelector('span').textContent = isAboutDetail ? '' : '设置';
  settingsTitle.textContent = isAboutDetail ? (ABOUT_DETAILS[settingsDetailKey]?.title || '详情') : (SETTINGS_TITLES[settingsPage] || '设置');
  if (settingsPage === 'layout') renderPageLayout();
  if (settingsPage === 'hidden') renderHiddenBookmarks();
  if (settingsPage === 'trash') renderTrashPage();
  if (settingsPage === 'about-detail') renderAboutDetail(settingsDetailKey);
  const hiddenCount = drawer.querySelector('[data-hidden-count]');
  const trashCount = drawer.querySelector('[data-trash-count]');
  if (hiddenCount) hiddenCount.textContent = hiddenBookmarkRecords().length;
  if (trashCount) trashCount.textContent = cleanTrash(false).length;
}
function liveBookmarkMap() {
  return new Map(RAW_CATS.flatMap(c => c.items).map(item => [String(item.id), item]));
}
function recordFolderLabel(record, item) {
  const source = item ? sourceCatOf(item) : null;
  return source?.path || source?.name || record?.path || record?.folderName || '原分类不可用';
}
function renderHiddenBookmarks() {
  const host = $('st-hidden-content');
  if (!host) return;
  const records = hiddenBookmarkRecords();
  if (!records.length) {
    host.innerHTML = '<p class="settings-empty">暂无隐藏书签。右键分类中的书签，选择“删除书签显示”后会出现在这里。</p>';
    return;
  }
  const live = liveBookmarkMap();
  host.innerHTML = '<p class="settings-lead">这些书签仍保留在' + BOOKMARK_SOURCE + '中，只是不在导航台显示。</p><div class="settings-record-list">' + records.map(record => {
    const item = live.get(String(record.id));
    const title = item?.n || record.title || '未命名书签';
    const url = item?.url || record.url || '';
    return `<article class="settings-record"><div class="settings-record-copy"><strong>${esc(title)}</strong><small>${esc(recordFolderLabel(record, item))}${url ? ` · ${esc(url)}` : ''}</small></div><button class="m-btn tiny" type="button" data-unhide="${esc(String(record.id))}"${item ? '' : ' disabled'}>${item ? '恢复显示' : '书签已不存在'}</button></article>`;
  }).join('') + '</div>';
}
function renderTrashPage() {
  const host = $('st-trash-content');
  if (!host) return;
  const records = cleanTrash();
  if (!records.length) {
    host.innerHTML = '<p class="settings-empty">回收站为空。真实删除的书签会在这里保留 30 天，之后自动清理。</p>';
    return;
  }
  host.innerHTML = '<p class="settings-lead">删除记录保留 30 天。本地库及浏览器 API 可尝试还原；Safari 自动同步的删除记录需在 Safari 中手动还原。</p><div class="settings-record-list">' + records.slice().sort((a, b) => Number(b.deletedAt) - Number(a.deletedAt)).map(record => {
    const days = Math.max(0, Math.ceil((TRASH_RETENTION_MS - (Date.now() - Number(record.deletedAt))) / 86400000));
    const when = Number(record.deletedAt) ? new Date(Number(record.deletedAt)).toLocaleDateString() : '未知时间';
    return `<article class="settings-record"><div class="settings-record-copy"><strong>${esc(record.title || '未命名书签')}</strong><small>${esc(recordFolderLabel(record))} · 删除于 ${esc(when)} · 还可保留 ${days} 天${record.url ? ` · ${esc(record.url)}` : ''}</small></div><button class="m-btn tiny" type="button" data-trash-restore="${esc(String(record.id))}"${record.url ? '' : ' disabled'}>${String(record.id).startsWith('safari-') ? '还原方法' : '还原'}</button></article>`;
  }).join('') + '</div>';
}
function navigateSettings(page, detailKey = '') {
  settingsPage = page; settingsDetailKey = detailKey;
  renderSettingsPage();
  settingsPages.scrollTop = 0;
}
function openSettings(page = 'home') {
  drawer.hidden = false; scrim.hidden = false;
  settingsPage = page; settingsDetailKey = '';
  renderSettingsPage();
  settingsPages.scrollTop = 0;
}
function closeSettings() {
  layoutSort.cancel(); categorySort.cancel();
  drawer.hidden = true; scrim.hidden = true; settingsPage = 'home'; settingsDetailKey = '';
}
$('settings-btn').addEventListener('click', () => openSettings());
$('set-close').addEventListener('click', closeSettings);
settingsBack.addEventListener('click', () => navigateSettings(settingsPage === 'about-detail' ? 'about' : 'home'));
scrim.addEventListener('click', closeSettings);
drawer.addEventListener('click', e => {
  const unhide = e.target.closest('[data-unhide]');
  if (unhide) { unhideBookmark(unhide.dataset.unhide); return; }
  const restore = e.target.closest('[data-trash-restore]');
  if (restore) { restoreTrashBookmark(restore.dataset.trashRestore); return; }
  const page = e.target.closest('[data-settings-page]');
  if (page) { navigateSettings(page.dataset.settingsPage); return; }
  const detail = e.target.closest('[data-about-detail]');
  if (detail) { navigateSettings('about-detail', detail.dataset.aboutDetail); }
});

const cityInput = $('st-city'), cityList = $('st-city-list');
const QUICK_CITIES = ['北京', '上海', '广州', '深圳', '杭州', '成都', '东京', '纽约'];
const CLOSE_ICON = '<svg viewBox="0 0 24 24" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const placeMeta = r => [r.admin1, r.country].filter(Boolean).join(' · ');
function hideCityList() { cityList.hidden = true; cityInput.setAttribute('aria-expanded', 'false'); }
function renderPlaceOptions(host, results, onPick, emptyText) {
  host.replaceChildren();
  if (!results.length) {
    const p = document.createElement('p');
    p.className = 'hint-line city-note'; p.textContent = emptyText;
    host.append(p); host.hidden = false; return;
  }
  for (const r of results) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'city-opt'; b.setAttribute('role', 'option');
    b.innerHTML = `<span class="city-opt-name">${esc(r.name)}</span><span class="city-opt-meta">${esc(placeMeta(r) || r.country_code || '')}</span>`;
    b.addEventListener('click', () => onPick(r));
    host.append(b);
  }
  host.hidden = false;
}
function renderQuickCities(host, onPick) {
  host.replaceChildren();
  const label = document.createElement('p');
  label.className = 'hint-line city-note'; label.textContent = '常用城市';
  const row = document.createElement('div'); row.className = 'city-chips';
  for (const name of QUICK_CITIES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'city-chip'; b.textContent = name;
    b.addEventListener('click', () => onPick(name));
    row.append(b);
  }
  host.append(label, row); host.hidden = false;
}
async function searchPlaces(q) {
  const tryName = async name => {
    const g = await fetchJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=12&language=zh`);
    return Array.isArray(g.results) ? g.results : [];
  };
  /* 地名无结果时尝试增减“市”后缀。 */
  let raw = await tryName(q);
  if (!raw.length && !ADMIN_TAIL.test(q)) raw = await tryName(q + '市');
  if (!raw.length && ADMIN_TAIL.test(q)) raw = await tryName(q.replace(ADMIN_TAIL, ''));
  return rankPlaces(q, raw);
}
/* 地名去除行政区后缀后，按匹配程度和人口排序。 */
const ADMIN_TAIL = /(特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|自治州|自治县|地区|新区|省|市|区|县|州|盟|旗)$/;
function normPlace(name) {
  let s = String(name || '').trim().replace(/\s+/g, '').toLowerCase();
  for (let i = 0; i < 3; i++) s = s.replace(ADMIN_TAIL, '');
  return s;
}
function rankPlaces(query, results) {
  const q = normPlace(query);
  const seen = new Set();
  const scored = [];
  for (const r of results) {
    if (!r || !r.name || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') continue;
    const n = normPlace(r.name);
    if (!n) continue;
    const key = n + '|' + r.country_code + '|' + r.latitude.toFixed(2) + ',' + r.longitude.toFixed(2);
    if (seen.has(key)) continue;
    seen.add(key);
    const rank = n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3;
    scored.push({ r, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || (b.r.population || 0) - (a.r.population || 0));
  const best = scored.length ? scored[0].rank : 0;
  return scored.filter(x => x.rank === best).map(x => x.r);
}
function applyCity(name) {
  const v = String(name || '').trim();
  if (!v) return;
  CFG.city = v; saveCfg();
  if (cityInput) { cityInput.value = v; hideCityList(); }
  closePanelCitySearch();
  loadWeather(); toast(`天气城市已更新为 ${v}`);
}
function searchInto(input, host, onPick) {
  let timer = null, seq = 0;
  const quick = () => { renderQuickCities(host, onPick); input.setAttribute('aria-expanded', 'true'); };
  input.addEventListener('focus', quick);
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if (!q) { quick(); return; }
    const id = ++seq;
    host.replaceChildren();
    const p = document.createElement('p'); p.className = 'hint-line city-note'; p.textContent = '正在查找可匹配的城市…';
    host.append(p); host.hidden = false;
    timer = setTimeout(async () => {
      try {
        const results = await searchPlaces(q);
        if (id !== seq) return;
        renderPlaceOptions(host, results, r => onPick(r.name), '没有匹配项。换更通用的名称试试，例如 Shanghai 而不是「上海市浦东新区」。');
      } catch (e) {
        if (id !== seq) return;
        renderPlaceOptions(host, [], () => {}, '城市列表获取失败：' + ((e && e.message) || '网络异常') + '。仍可直接输入城市名后点「应用」。');
      }
    }, 260);
  });
  host.hidden = true; input.setAttribute('aria-expanded', 'false');
}
searchInto(cityInput, cityList, applyCity);
cityInput.addEventListener('blur', () => setTimeout(() => { if (cityInput.value.trim()) hideCityList(); }, 180));
$('st-city-save').addEventListener('click', () => applyCity(cityInput.value));
cityInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); applyCity(cityInput.value); }
  if (e.key === 'ArrowDown') { e.preventDefault(); const first = cityList.querySelector('.city-opt'); if (first) first.focus(); }
});
function bindOverlay(scrim, close) {
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  scrim.addEventListener('click', e => { if (e.target === scrim) close(); });
  document.body.append(scrim);
  return () => document.removeEventListener('keydown', onKey, true);
}

let panelSearchTimer = null, panelSearchSeq = 0;
function panelCitySearch() {
  const input = $('wx-city-input'), host = $('wx-city-list');
  const q = input.value.trim();
  clearTimeout(panelSearchTimer);
  if (!q) { renderQuickCities(host, name => applyCity(name)); return; }
  const id = ++panelSearchSeq;
  host.replaceChildren();
  const p = document.createElement('p');
  p.className = 'hint-line city-note'; p.textContent = '正在查找可匹配的城市…';
  host.append(p); host.hidden = false;
  panelSearchTimer = setTimeout(async () => {
    try {
      const results = await searchPlaces(q);
      if (id !== panelSearchSeq) return;
      renderPlaceOptions(host, results, r => applyCity(r.name), '没有匹配项。换更通用的名称试试，例如 Shanghai 而不是「上海市浦东新区」。');
    } catch (e) {
      if (id !== panelSearchSeq) return;
      renderPlaceOptions(host, [], () => {}, '城市列表获取失败：' + ((e && e.message) || '网络异常') + '。仍可直接输入城市名后回车。');
    }
  }, 260);
}
function showPanelCitySearch() {
  $('wx-body').hidden = true;
  $('wx-search').hidden = false;
  const input = $('wx-city-input');
  input.value = '';
  panelCitySearch();
  positionPanel();
  input.focus();
}
function closePanelCitySearch() {
  $('wx-search').hidden = true;
  $('wx-body').hidden = false;
}
function applyHomeChrome() {
  const wrap = $('wx-wrap');
  if (wrap) wrap.hidden = CFG.showWeather === false;
}

function refreshCalendar() { renderCalendar(true); }


const COUNT_FIELD = { favorites: 'favCount', recent: 'recentCount', folders: 'folderCount' };
const COUNT_RANGE = { favorites: [FAV_MIN, FAV_MAX], recent: [3, 8], folders: [2, 8] };
const countOf = key => ({ favorites: favLimit, recent: recentLimit, folders: folderLimit })[key]();
function openPageManager() { openSettings('layout'); }
function renderPageLayout() {
  const root = $('st-layout-page');
  if (!root) return;
  root.querySelectorAll('[data-pm-catmode]').forEach(b => {
    const on = b.dataset.pmCatmode === CFG.categoryMode;
    b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
  });
  root.querySelector('[data-pm-mode-hint]').textContent = autoMode()
    ? `按内置网站库把书签归入 ${(globalThis.SITE_CATEGORY_ORDER || []).length} 个分类，分不出的进入「未分类书签」；右键书签可手动改归属，两种模式的顺序各自保留。`
    : '按现有书签文件夹展示。切到自动分类不会改动或删除这些文件夹。';
  const list = root.querySelector('[data-pm-list]'), preview = root.querySelector('[data-pm-preview]');
  layoutSort.cancel();
  list.replaceChildren();
  for (const key of homeSections()) {
    const meta = WIDGET_META[key], on = sectionVisible(key), li = document.createElement('li');
    li.dataset.key = key; li.draggable = true;
    li.innerHTML = `<span class="pm-handle" aria-hidden="true">⠿</span>
      <span class="pm-copy"><strong>${meta.name}</strong><small>${on ? meta.hint : '已隐藏'}</small></span>
      <span class="pm-ctl">${meta.max ? `<span class="stepper stepper-sm"><button type="button" data-pm-step="${key}:-1" aria-label="减少">−</button><b data-pm-value="${key}">${countOf(key)}</b><button type="button" data-pm-step="${key}:1" aria-label="增加">+</button></span>` : ''}</span>
      <label class="switch"><input type="checkbox" data-pm-toggle="${key}"${on ? ' checked' : ''}><span></span></label>`;
    list.append(li);
  }
  const weatherOn = CFG.showWeather !== false, weather = document.createElement('li');
  weather.dataset.key = 'weather';
  weather.innerHTML = `<span class="pm-handle" aria-hidden="true"></span>
    <span class="pm-copy"><strong>天气</strong><small>${weatherOn ? '右上角的城市与温度，位置固定' : '已隐藏'}</small></span>
    <span class="pm-ctl"></span>
    <label class="switch"><input type="checkbox" data-pm-toggle="weather"${weatherOn ? ' checked' : ''}><span></span></label>`;
  list.append(weather);
  const cols = favColumns(favLimit());
  preview.style.setProperty('--fav-cols', cols);
  preview.classList.toggle('dense', cols >= 7);
  preview.innerHTML = Array.from({ length: favLimit() }, () => '<i></i>').join('');
  root.querySelector('[data-pm-value="favorites"]').textContent = favLimit();
  const favOn = sectionVisible('favorites');
  root.querySelector('[data-pm-step="favorites:1"]').disabled = !favOn;
  root.querySelector('[data-pm-step="favorites:-1"]').disabled = !favOn;
  renderOrderList();
}
function applyPageSettings() {
  saveCfg(); render(); applyHomeChrome(); renderSettingsPage();
}
const layoutList = $('st-layout-page').querySelector('[data-pm-list]');
const layoutSort = HubSettingsSort.bind(layoutList, {
  fixedTail: ['weather'],
  canDrag: row => row.draggable && row.dataset.key !== 'weather',
  onCommit: order => { CFG.homeSections = order.filter(key => key !== 'weather'); applyPageSettings(); }
});
drawer.addEventListener('change', e => {
  const toggle = e.target.closest('[data-pm-toggle]'); if (!toggle) return;
  const key = toggle.dataset.pmToggle;
  if (key === 'weather') CFG.showWeather = toggle.checked;
  else CFG['show' + key[0].toUpperCase() + key.slice(1)] = toggle.checked;
  applyPageSettings();
  if (key === 'weather' && toggle.checked) loadWeather();
});
drawer.addEventListener('click', e => {
  const mode = e.target.closest('[data-pm-catmode]');
  if (mode) {
    const next = mode.dataset.pmCatmode;
    if (next !== CFG.categoryMode) {
      CFG.categoryMode = next; rebuildCats(); initOrder(); saveCfg(); render(); renderSettingsPage();
      toast(next === 'auto' ? '已按网站库自动分类' : '已恢复使用书签文件夹');
    }
    return;
  }
  const step = e.target.closest('[data-pm-step]'); if (!step) return;
  const [key, delta] = step.dataset.pmStep.split(':');
  const [lo, hi] = COUNT_RANGE[key], field = COUNT_FIELD[key];
  CFG[field] = clampInt(countOf(key) + Number(delta), lo, hi, countOf(key));
  applyPageSettings();
});
const ABOUT_DETAILS = {
  version: { title: '版本介绍', html: `
    <p class="about-kicker">书签导航台 · bookmarknavigator 1.13.2</p>
    <h3>在新标签页查找和整理书签</h3>
    <p>导航台在新标签页集中展示书签、分类、天气和待办事项。支持按名称或网址搜索，按文件夹浏览，并调整首页布局。</p>
    <h4>主要能力</h4>
    <ul><li>读取真实书签文件夹，支持搜索、排序、拖动调整顺序和按网站库自动分类。</li><li>首页提供常用书签、最近添加、分类快捷入口和待办事项卡片。</li><li>待办支持时间点、30 分钟粒度的时间区间、颜色标记和 24:00 结束时间。</li><li>隐藏书签与回收站分别处理“只从导航台移除”和“从书签数据源真实删除”两种操作。</li><li>天气、内置图标和用户主动授权获取的高清图标均有独立的权限与失败提示。</li></ul>
    <h4>兼容与边界</h4>
    <p>扩展使用 Manifest V3，支持 Chrome / Edge 116+、Firefox 109+ 和 Safari 16+（macOS 12+）。Safari 默认使用本地导入库，可选 Safari 26 原生自动同步助手（实验功能）。书签、历史记录、天气请求和网站图标获取都受浏览器权限与第三方服务可用性影响。</p>
    <p class="about-note">版本号以当前扩展清单为准。升级不会主动删除书签或待办；真实删除前应优先确认回收站提示。</p>` },
  help: { title: '使用帮助', html: `
    <h3>从第一次打开开始</h3>
    <ol><li>在左侧选择“主页”“全部书签”或具体分类；顶部搜索可同时匹配书签名称和网址。</li><li>首页常用书签可拖动排序；点击“+”可以手动选择要显示的书签，页面布局中可调整数量。</li><li>分类页面支持排序、移动和右键操作。移动会保存到${BOOKMARK_SOURCE}；自动分类模式下，移动只保存导航台内的归属覆盖。</li></ol>
    <h4>书签显示与删除</h4>
    <ul><li>常用书签中选择“取消在常用书签中显示”：只影响首页常用区，原书签仍在${BOOKMARK_SOURCE}中。</li><li>具体分类中选择“删除书签显示”：从导航台隐藏，之后可在设置的“隐藏书签”中恢复。</li><li>选择“删除书签”：从 ${BOOKMARK_SOURCE}中真实删除，并在导航台回收站保留 30 天；原文件夹存在时优先还原回原文件夹。</li></ul>
    <h4>待办与天气</h4>
    <p>点击待办事项中的日期进入日视图。时间点适合单个提醒，时间区间适合会议或任务占用；跨天事项请拆成两个日期记录。天气胶囊点击后可查看逐小时和逐日预报，城市可在设置中更换。</p>
    <h4>拖动书签</h4>
    <ul><li>在首页分类卡片里点开某个文件夹后，可把里面的书签直接拖到左侧分类栏，移动到别的分类；「全部书签」「最近添加」「最常访问」是聚合视图，不能作为落点。</li><li>在某个分类页内，把书签拖到另一张卡片的前后即可调整顺序；在「自定义顺序」下拖动会自动切换到自定义顺序并保存。</li><li>「最近添加」和「最常访问」按时间或访问频率排列，不能在里面手动重排，可把书签拖到侧栏的真实分类。</li><li>移动和重排会保存到${BOOKMARK_SOURCE}；自动分类模式下顺序只保存在导航台本地。</li></ul>
    <h4>打开浏览器时显示的页面</h4>
    <p>导航台接管的是<strong>新标签页</strong>：新建标签页、新建窗口，以及浏览器启动时若选择「打开新标签页」，都会显示这个页面。</p>
    ${LOCAL_LIBRARY ? '<p>Safari 请在设置 > 通用中，将“新标签页打开方式”设为书签导航台，再检查新窗口与启动时的打开方式。</p>' : '<p>扩展接管新标签页，启动页面与主页按钮由浏览器自己的设置管理。Chrome 可打开 <code>chrome://settings/onStartup</code>，选择“打开新标签页”；Edge 和 Firefox 请在对应的启动设置中检查。</p>'}
    <p class="about-note">若设置正确却仍显示其他页面，请检查管理策略和其他新标签页扩展。</p>
    <h4>遇到问题时</h4>
    <p>先确认扩展已获得书签、历史和存储权限；天气或高清图标失败时，请优先阅读页面提示中的具体域名、权限和 HTTP 错误，不要反复点击造成重复授权。</p>` },
  feedback: { title: '意见反馈', html: `
    <h3>让问题可以被复现和定位</h3>
    <p>反馈前请先确认问题是否稳定出现，并尽量提供最短复现路径。bookmarknavigator 当前没有内置在线提交入口；你可以将反馈发送至 <a class="about-link" href="mailto:bookmarknavigator@163.com">bookmarknavigator@163.com</a>，邮件主题建议包含“bookmarknavigator 反馈”。此页面不会自动发送任何信息。</p>
    <h4>建议反馈模板</h4>
    <div class="about-callout">问题类型：显示 / 书签操作 / 待办 / 天气 / 图标 / 权限<br>复现步骤：1. … 2. … 3. …<br>期望结果：……<br>实际结果：……<br>环境：扩展版本、浏览器版本、操作系统、浅色或深色模式</div>
    <h4>如果涉及权限或网络</h4>
    <p>请同时附上页面显示的完整错误提示、失败域名和发生时间。若问题与天气或高清图标有关，请说明是否刚刚撤销过站点权限。</p>
    <h4>提交前检查</h4>
    <ul><li>不要提交密码、验证码、Cookie、完整的私密网址参数或公司内部网址。</li><li>截图前遮挡账号、令牌、邮箱和书签中的敏感名称。</li><li>如果只是单个网站失败，请同时说明其他网站是否正常。</li></ul>` },
  logs: { title: '上传日志', html: `
    <h3>仅在排查问题时提供</h3>
    <p>导航台默认不会自动上传日志，也没有后台静默收集。此页面用于说明人工排查范围；只有你主动复制并提交内容时，日志才会离开本机。</p>
    <h4>建议收集的内容</h4>
    <ul><li>扩展版本、浏览器版本、操作系统和问题发生的页面。</li><li>页面可见的错误提示，以及与操作时间相近的 Console 错误。</li><li>必要时提供脱敏后的书签分类名称、失败域名和复现步骤。</li></ul>
    <h4>手动排查步骤</h4>
    <ol><li>复现问题后按 <code>F12</code> 打开开发者工具，切换到 Console。</li><li>只复制与本次操作时间相近的红色错误和一两条上下文，不要导出全部历史记录。</li><li>提交前删除网址中的 token、Cookie、邮箱、内部域名和其他敏感字段。</li></ol>
    <p class="about-note">当前版本点击此项只展示说明，不会发起网络上传，也不会自动创建日志文件。</p>` },
  terms: { title: '服务协议', html: `
    <h3>使用约定</h3>
    <p>本扩展用于在本机展示和整理浏览器书签。安装和使用即表示你理解浏览器权限、外部服务和书签操作的边界，并愿意对自己的操作负责。</p>
    <h4>用户责任</h4>
    <ul><li>确保自己拥有所使用书签、网站内容和反馈材料的合法权利。</li><li>在真实删除书签前确认操作对象；回收站提供 30 天的还原机会，但不保证浏览器、文件夹或外部服务始终可用。</li><li>自行判断外部网站内容、图标资源和天气信息的安全性与准确性。</li></ul>
    <h4>第三方服务与可用性</h4>
    <p>天气、城市检索和用户主动授权的网站图标获取依赖第三方服务。服务中断、网络故障、数据延迟、权限变化或网站结构变更，可能导致相应功能不可用。</p>
    <h4>变更与终止</h4>
    <p>功能、界面、权限说明和第三方服务可能随版本更新而调整。你可以随时停用或卸载扩展；卸载前请按需导出或确认本地配置、隐藏记录和回收站内容。</p>
    <p class="about-note">本页面是产品使用说明，不构成法律、隐私或安全方面的专业意见。</p>` },
  privacy: { title: '隐私协议', html: `
    <h3>数据处理原则</h3>
    <p>导航台以本地处理为默认原则：书签内容、访问频率、布局设置、待办、隐藏记录、回收站记录和已获取图标保存在浏览器扩展的本地存储中，不作为用户画像对外提供。</p>
    <h4>数据流向</h4>
    <dl class="about-facts"><div><dt>本地书签</dt><dd><strong>用途：</strong>渲染分类、搜索、排序和移动。<br><strong>去向：</strong>${LOCAL_LIBRARY ? '本地模式只处理导入库。启用原生同步后，助手仅导出书签 HTML 到本机同步数据容器并读取；本地测试版使用本扩展的容器，正式签名版使用 App Group。删除通过 Safari 界面执行，会修改原书签。' : '通过浏览器书签 API 在本机读取和修改。'}</dd></div><div><dt>访问频率</dt><dd><strong>用途：</strong>生成“最常访问”排序。<br><strong>去向：</strong>${LOCAL_LIBRARY ? '仅统计从导航台点击打开网站的次数，不读取 Safari 浏览历史。' : '在本机聚合，不上传浏览历史。'}</dd></div><div><dt>天气城市</dt><dd><strong>用途：</strong>查询坐标与天气预报。<br><strong>去向：</strong>发送城市名称或坐标到 Open-Meteo。</dd></div><div><dt>高清图标</dt><dd><strong>用途：</strong>展示更清晰的网站图标。<br><strong>去向：</strong>仅在你主动授权后访问所选网站公开声明。</dd></div></dl>
    <h4>保存期限与控制权</h4>
    <p>配置和缓存通常保留到你重置设置、清除扩展数据或卸载扩展；隐藏书签会持续隐藏到你恢复显示；真实删除记录最多保留 30 天，过期自动清理。你可以在设置中恢复隐藏书签、还原回收站记录或恢复默认设置。</p>
    <p class="about-note">不会主动上传书签内容、账户信息、密码、Cookie 或完整浏览历史；具体网络请求仍受浏览器权限和第三方服务策略约束。</p>` },
  'open-source': { title: '开源条款', html: `
    <h3>资源与许可</h3>
    <p>项目自有代码采用 MIT License，Copyright (c) 2026 DrMush &lt;bookmarknavigator@163.com&gt;，允许商业使用及用于闭源产品。第三方字体、图片和数据分别适用其许可或权利人条款。</p>
    <p><a href="licenses/index.html" target="_blank" rel="noopener">打开完整的第三方资源版权与许可说明</a>，可离线查看许可全文和逐项来源清单。</p>
    <h4>资源类别</h4>
    <dl class="about-facts"><div><dt>项目代码</dt><dd><a href="licenses/project-MIT.txt" target="_blank" rel="noopener">MIT License 全文</a>；再分发时保留版权与许可声明。</dd></div><div><dt>字体</dt><dd>Outfit © 2021 The Outfit Project Authors；JetBrains Mono © 2020 The JetBrains Mono Project Authors。均采用 SIL Open Font License 1.1，原文随包保留。</dd></div><div><dt>图片与标识</dt><dd>天气图片与网站品牌图标保留各自权利人的版权和商标权，项目 MIT 许可不对它们额外授权。来源和资源指纹见完整清单。</dd></div><div><dt>天气与城市数据</dt><dd>天气由 Open-Meteo 提供，城市数据基于 GeoNames；数据适用 CC BY 4.0。显示结果包含取整、预报整理或候选地名排序。免费 API 仅供非商业用途，商业场景须按服务条款安排。</dd></div><div><dt>系统组件</dt><dd>浏览器 API、macOS 框架及系统 libz 由相应平台提供，项目不打包其 SDK、源代码或系统动态库。</dd></div></dl>
    <h4>分发与修改</h4>
    <p>重新分发或修改扩展时，请保留源文件中的版权、许可和来源说明，并核对第三方资源是否允许再分发。网站名称、Logo 和商标仍属于各自权利人。</p>
    <p class="about-note">如需查看具体资源来源和版本，请以扩展包内的源文件、清单和随附声明为准。</p>` },
  'personal-info': { title: '个人信息清单', html: `
    <h3>本地处理的数据类别</h3>
    <p>下表说明导航台可能读取、生成或保存的数据，以及它们被使用的目的。默认处理范围限于当前浏览器用户和当前扩展实例。</p>
    <dl class="about-facts"><div><dt>书签信息</dt><dd><strong>字段：</strong>名称、网址、文件夹、添加时间。<br><strong>目的：</strong>展示、搜索、移动和排序。</dd></div><div><dt>访问频率</dt><dd><strong>字段：</strong>网站主机名与访问次数。<br><strong>目的：</strong>生成最常访问排序。</dd></div><div><dt>使用偏好</dt><dd><strong>字段：</strong>主题、城市、布局、分类顺序、常用列表。<br><strong>目的：</strong>保持界面符合你的选择。</dd></div><div><dt>待办与状态</dt><dd><strong>字段：</strong>日期、文字、时间、颜色、隐藏记录和回收站记录。<br><strong>目的：</strong>显示提醒、撤销隐藏和尝试还原。</dd></div><div><dt>图标缓存</dt><dd><strong>字段：</strong>内置、用户自定义或主动获取的图标数据。<br><strong>目的：</strong>减少重复加载并保持图标一致。</dd></div></dl>
    <h4>用户可执行的控制</h4>
    <ul><li>在设置中切换主题、城市、布局和分类显示。</li><li>在隐藏书签页面恢复显示，在回收站页面尝试还原。</li><li>通过恢复默认设置清除主要界面偏好；清除扩展数据或卸载扩展可移除本地存储。</li></ul>
    <p class="about-note">这些数据用于渲染和排序，不用于广告、画像、跨设备同步或对外出售。</p>` },
  'third-party': { title: '第三方信息共享清单', html: `
    <h3>仅限必要请求</h3>
    <p>导航台没有广告、统计或图标聚合服务。只有在功能需要、且满足对应权限条件时，才会向下列服务发起请求。</p>
    <h4>服务与数据范围</h4>
    <dl class="about-facts"><div><dt>Open-Meteo 地理编码</dt><dd><strong>用途：</strong>把设置中输入的城市转换为坐标。<br><strong>发送：</strong>城市名称、语言和结果数量。</dd></div><div><dt>Open-Meteo 天气接口</dt><dd><strong>用途：</strong>获取当前、逐小时和逐日预报。<br><strong>发送：</strong>城市坐标、预报字段、时区和预报范围。</dd></div><div><dt>用户授权网站</dt><dd><strong>用途：</strong>读取公开 favicon / manifest 声明获取高清图标。<br><strong>发送：</strong>仅访问你明确选择并授权的网站公开资源。</dd></div><div><dt>浏览器平台</dt><dd><strong>用途：</strong>读取书签、历史、存储和权限状态。<br><strong>范围：</strong>由扩展清单与浏览器权限页面共同决定。</dd></div></dl>
    <h4>不会共享的内容</h4>
    <ul><li>不会主动发送书签名称、完整书签网址、账户信息、密码、Cookie 或完整浏览历史。</li><li>不会在未授权时访问任意网站图标，也不会把失败的图标请求转交给第三方聚合服务。</li><li>天气请求不会携带账户凭据；请求失败时优先使用本地缓存或显示诊断提示。</li></ul>
    <p class="about-note">第三方服务的域名、接口策略、隐私政策和可用性可能变化；使用前请以其官方说明为准。</p>` }
};

const legalScrim = $('legal-scrim');
const legalSummary = $('legal-summary');
const legalDocument = $('legal-document');
const legalConsent = $('legal-consent');
const legalAgree = $('legal-agree');
const legalDocTitle = $('legal-doc-title');
const legalDocBody = $('legal-doc-body');
const legalDocBack = $('legal-doc-back');
const legalDocReturn = $('legal-doc-return');
function renderLegalDocument(key) {
  const detail = ABOUT_DETAILS[key] || ABOUT_DETAILS.terms;
  legalDocTitle.textContent = detail.title;
  legalDocBody.innerHTML = detail.html;
}
function showLegalDocument(key) {
  renderLegalDocument(key);
  legalSummary.hidden = true;
  legalDocument.hidden = false;
  legalDocBack.focus();
}
function showLegalSummary() {
  legalDocument.hidden = true;
  legalSummary.hidden = false;
  legalConsent.focus();
}
function showLegalConsent() {
  if (CFG.legalAccepted) return;
  legalConsent.checked = false;
  legalAgree.disabled = true;
  showLegalSummary();
  legalScrim.hidden = false;
  legalConsent.focus();
}
function closeLegalConsent() {
  legalScrim.hidden = true;
  legalDocument.hidden = true;
  legalSummary.hidden = false;
}
legalConsent.addEventListener('change', () => { legalAgree.disabled = !legalConsent.checked; });
legalScrim.addEventListener('click', e => {
  const doc = e.target.closest('[data-legal-doc]');
  if (doc) { showLegalDocument(doc.dataset.legalDoc); return; }
  if (e.target.closest('#legal-doc-back, #legal-doc-return')) { showLegalSummary(); }
});
legalAgree.addEventListener('click', async () => {
  if (!legalConsent.checked) return;
  legalAgree.disabled = true;
  CFG.legalAccepted = true;
  await saveCfg();
  closeLegalConsent();
  loadWeather();
});

function renderAboutDetail(key) {
  const detail = ABOUT_DETAILS[key] || ABOUT_DETAILS.version;
  const host = $('st-about-detail-page').querySelector('[data-about-detail-body]');
  host.innerHTML = detail.html;
  if (key === 'help' && LOCAL_LIBRARY) host.innerHTML += '<p class="about-callout">Safari 请使用设置 > 通用 > 新标签页打开方式，选择书签导航台。本地模式需导入 HTML；开启原生同步后请查看“设置 > 本地书签”中的连接状态。同步模式仅支持读取及经核对的单个删除，编辑、移动和还原请在 Safari 中操作。</p>';
}

const orderEl = $('st-order');
function renderOrderList() {
  categorySort.cancel();
  initOrder();
  const byKey = new Map(masterCats().map(c => [c.key, c]));
  orderEl.innerHTML = currentOrder().map(k => {
    const c = byKey.get(k); if (!c) return '';
    const off = CFG.hidden.includes(k);
    return `<li draggable="${c.virtual ? 'false' : 'true'}" data-key="${esc(k)}" class="${off ? 'off' : ''}">
      <span class="grip"></span><span class="nm">${esc(c.name)}</span><span class="cnt">${c.items.length}</span>
      ${c.virtual ? '<span class="nm" style="flex:none;font-size:11px;color:var(--ink-4)">聚合</span>'
        : `<button class="row-del" data-del="${esc(k)}" title="移出面板" aria-label="将${esc(c.name)}移出面板">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`}</li>`;
  }).join('');
  applyTheme();
}

/* 分类显示独立于书签树；移出面板不删除文件夹。 */
function catName(k) { const c = findCat(k); return c ? c.name : k; }
// 从书签树确定新分类的父目录。

function removeCat(k) {
  if (k === FREQUENT_KEY) { toast('「常用」是聚合分类，不能移出'); return; }
  const name = catName(k);
  CFG.removed = (CFG.removed || []).concat(k);
  CFG.hidden = CFG.hidden.filter(x => x !== k);
  CFG[orderField()] = currentOrder().filter(x => x !== k);
  if (currentKey === k) currentKey = 'all';
  saveCfg(); renderOrderList(); render();
  toast(`已将「${name}」移出面板，书签未删除`);
}
function addCat(k) {
  CFG.removed = (CFG.removed || []).filter(x => x !== k);
  CFG.hidden = CFG.hidden.filter(x => x !== k);
  initOrder(); saveCfg(); renderOrderList(); render();
  toast(`已添加「${catName(k)}」`);
}

async function createCat(raw) {
  const name = (raw || '').trim();
  if (!name) { toast('请输入分类名称'); return false; }
  if (masterCats().some(c => c.name === name)) { toast('已存在同名分类'); return false; }
  try {
    await extCall(HUB_API.bookmarks, 'create', { ...(bookmarkBarId ? { parentId: bookmarkBarId } : {}), title: name });
    toast(`已创建书签文件夹「${name}」`);
  } catch (err) {
    toast('创建失败：' + (err && err.message ? err.message : '未知错误'));
    return false;
  }
  refresh();
  return true;
}

const addList = $('addcat-list');
function openAddCat() {
  const avail = masterCats().filter(c => c.key !== FREQUENT_KEY && (CFG.removed || []).includes(c.key));
  addList.innerHTML = avail.length
    ? `<p class="hint-line grp">从书签文件夹添加</p>`
      + avail.map(c => `<button data-key="${c.key}">${catIcon(c.name)}<span>${esc(c.name)}</span><span class="cnt">${c.items.length}</span></button>`).join('')
    : '';
  $('addcat-scrim').hidden = false;
}
$('st-cat-add').addEventListener('click', openAddCat);
$('ac-cancel').addEventListener('click', () => $('addcat-scrim').hidden = true);
$('addcat-scrim').addEventListener('click', e => { if (e.target === $('addcat-scrim')) $('addcat-scrim').hidden = true; });
$('ac-create').addEventListener('click', async () => {
  if (await createCat($('ac-name').value)) { $('ac-name').value = ''; openAddCat(); }
});
$('ac-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('ac-create').click(); });
addList.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  addCat(b.dataset.key); openAddCat();
});

orderEl.addEventListener('click', e => {
  const del = e.target.closest('.row-del');
  if (del) { e.stopPropagation(); removeCat(del.dataset.del); return; }
  const li = e.target.closest('li'); if (!li) return;
  const k = li.dataset.key, i = CFG.hidden.indexOf(k);
  i < 0 ? CFG.hidden.push(k) : CFG.hidden.splice(i, 1);
  saveCfg(); renderOrderList(); render();
});
const categorySort = HubSettingsSort.bind(orderEl, {
  onCommit: order => {
    CFG[orderField()] = order; saveCfg(); renderOrderList(); render(); toast('分类顺序已保存');
  }
});
$('st-reset').addEventListener('click', () => {
  CFG = Object.assign({}, DEFAULTS); saveCfg();
  collapsed.clear(); cityInput.value = CFG.city; currentKey = 'all';
  folderPreviewKey = null; keyword = ''; $('search').value = ''; calendarDayKey = null;
  saveViewState(); hideCityList(); applyHomeChrome();
  applyTheme(); renderOrderList(); render(); loadWeather();
  toast('已恢复默认设置');
});

function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._tm);
  t._tm = setTimeout(() => { t.hidden = true; }, 1900);
}

navEl.addEventListener('click', e => {
  const a = e.target.closest('a'); if (!a) return;
  e.preventDefault();
  currentKey = a.dataset.key;
  folderPreviewKey = null;
  saveViewState(); render();
});
contentEl.addEventListener('click', e => {
  const preview = e.target.closest('[data-folder-preview]');
  if (preview) {
    folderPreviewKey = preview.dataset.folderPreview;
    saveViewState(); renderHome();
    return;
  }
  if (e.target.closest('[data-folder-back]')) {
    folderPreviewKey = null;
    saveViewState(); renderHome();
    return;
  }
  const all = e.target.closest('[data-folder-all]');
  if (all) {
    currentKey = all.dataset.folderAll;
    folderPreviewKey = null;
    keyword = ''; $('search').value = '';
    saveViewState(); render();
    return;
  }
  const go = e.target.closest('[data-go]');
  if (go) { currentKey = go.dataset.go; folderPreviewKey = null; keyword = ''; $('search').value = ''; saveViewState(); render(); return; }
  if (e.target.closest('[data-settings]')) { openSettings(); return; }
  if (e.target.closest('[data-page-manage]')) { openPageManager(); return; }
  if (e.target.closest('[data-date]')) { calendarDayKey = e.target.closest('[data-date]').dataset.date; saveViewState(); renderCalendar(); return; }
  if (e.target.closest('[data-day-back]')) { calendarDayKey = null; saveViewState(); renderCalendar(); return; }
  const month = e.target.closest('[data-month]');
  if (month || e.target.closest('[data-today]')) {
    calendarMonth = month ? new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + Number(month.dataset.month), 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    calendarDayKey = null; saveViewState(); renderCalendar(); return;
  }
  const head = e.target.closest('.sec-head');
  if (head) {
    const sec = head.closest('.sec'), k = sec.dataset.key;
    collapsed.has(k) ? collapsed.delete(k) : collapsed.add(k);
    sec.classList.toggle('collapsed');
    return;
  }
  /* 仅阻止拖动结束时触发的卡片点击。 */
  if (suppressClick && e.target.closest('.card')) { suppressClick = false; e.preventDefault(); }
});
let suppressClick = false;

/* 隐藏与回收站 */
function hideBookmark(item) {
  if (!item) return;
  const id = String(item.id);
  const records = hiddenBookmarkRecords().filter(v => String(v.id) !== id);
  const source = sourceCatOf(item);
  records.push({
    id, title: item.n, url: item.url,
    folderName: source?.name || '', path: source?.path || source?.name || '',
    hiddenAt: Date.now()
  });
  CFG.hiddenItems = records;
  saveCfg(); rebuildCats(); render();
  if (!drawer.hidden) renderSettingsPage();
  toast('已隐藏显示，书签仍保留在' + BOOKMARK_SOURCE);
}
function unhideBookmark(id) {
  const before = hiddenBookmarkRecords();
  const next = before.filter(v => String(v.id) !== String(id));
  if (next.length === before.length) return;
  CFG.hiddenItems = next;
  saveCfg(); rebuildCats(); render();
  if (!drawer.hidden) renderSettingsPage();
  toast('已恢复书签显示');
}
function removeFromFavorites(item) {
  if (!item) return;
  const id = String(item.id);
  if (Array.isArray(CFG.favoriteIds)) CFG.favoriteIds = CFG.favoriteIds.filter(v => String(v) !== id);
  CFG.favoriteHiddenIds = [...new Set((CFG.favoriteHiddenIds || []).map(String).filter(v => v !== id).concat(id))];
  saveCfg(); render(); toast('已取消在常用书签中显示，原书签未删除');
}
function makeTrashRecord(item) {
  const source = sourceCatOf(item);
  const index = source ? source.items.findIndex(v => String(v.id) === String(item.id)) : -1;
  return {
    id: String(item.id), title: item.n, url: item.url,
    parentId: source?.folderId || null, folderName: source?.name || '', path: source?.path || source?.name || '',
    index: index >= 0 ? index : undefined, deletedAt: Date.now()
  };
}
async function deleteBookmarkToTrash(item) {
  if (!item) return;
  const safariSource = String(item.id).startsWith('safari-');
  if (!confirm(`从${safariSource ? 'Safari 原书签' : BOOKMARK_SOURCE}中删除「${item.n}」？\n${safariSource ? '将影响 Safari 原书签及其 iCloud 同步。助手会再次核对和确认；删除记录保留 30 天，本版需要在 Safari 手动还原。' : '删除后会在导航台回收站保留 30 天，可尝试还原。'}`)) return;
  const record = makeTrashRecord(item);
  closeCtx();
  try {
    await extCall(HUB_API.bookmarks, 'remove', item.id);
    CFG.trash = cleanTrash(false).filter(v => String(v.id) !== String(item.id)).concat(record);
    CFG.hiddenItems = hiddenBookmarkRecords().filter(v => String(v.id) !== String(item.id));
    if (Array.isArray(CFG.favoriteIds)) CFG.favoriteIds = CFG.favoriteIds.filter(v => String(v) !== String(item.id));
    CFG.favoriteHiddenIds = (CFG.favoriteHiddenIds || []).map(String).filter(v => v !== String(item.id));
    saveCfg();
    toast(safariSource ? '已从 Safari 删除，记录已存入回收站；还原需在 Safari 中操作' : '已删除书签，可在设置 > 回收站中还原');
  } catch (err) {
    if (err?.safariDeleted) {
      CFG.trash = cleanTrash(false).filter(v => String(v.id) !== String(item.id)).concat(record);
      saveCfg(); refresh();
    }
    toast('删除失败：' + (err && err.message ? err.message : '未知错误'));
    return;
  }
  refresh();
}
async function restoreTrashBookmark(id) {
  const record = cleanTrash().find(v => String(v.id) === String(id));
  if (!record || !record.url) return;
  if (String(record.id).startsWith('safari-')) {
    alert(`请在 Safari 中手动重新添加此书签：\n${record.title}\n${record.url}\n原目录：${record.path || record.folderName || 'Safari 书签'}\n\n同步模式暂不支持自动写回还原。`);
    return;
  }
  const payload = { title: record.title || '未命名书签', url: record.url };
  const parents = [...new Set([record.parentId, bookmarkBarId].filter(Boolean))];
  let created = null, lastError = null;
  try {
    for (const parentId of parents) {
      const attempts = Number.isInteger(record.index)
        ? [{ ...payload, parentId, index: record.index }, { ...payload, parentId }]
        : [{ ...payload, parentId }];
      for (const details of attempts) {
        try {
          created = await extCall(HUB_API.bookmarks, 'create', details);
          break;
        } catch (err) {
          lastError = err;
        }
      }
      if (created) break;
    }
    if (!created) throw lastError || new Error('没有可用的书签文件夹');
    CFG.trash = cleanTrash(false).filter(v => String(v.id) !== String(id));
    saveCfg();
    toast(`已还原「${record.title || '书签'}」`);
    refresh();
    if (!drawer.hidden) renderSettingsPage();
  } catch (err) {
    toast('还原失败：' + (err && err.message ? err.message : '找不到可用的书签文件夹'));
  }
}

/* 书签操作 */
const ctxEl = $('ctxmenu');
let ctxCard = null, ctxMode = 'aggregate';
function cardContext(card) {
  if (card?.closest('.home-favorites')) return 'favorites';
  if (card?.closest('.sec[data-key]')) return 'category';
  const cat = findCat(currentKey);
  return cat && !cat.virtual && !['home', 'all', '@recent', '@frequent'].includes(currentKey) ? 'category' : 'aggregate';
}
function syncContextActions() {
  const favorite = ctxEl.querySelector('[data-act="favorite-remove"]');
  const hide = ctxEl.querySelector('[data-act="hide-display"]');
  const remove = ctxEl.querySelector('[data-act="delete"]');
  if (favorite) favorite.hidden = ctxMode !== 'favorites';
  if (hide) hide.hidden = ctxMode === 'favorites';
  if (remove) remove.hidden = ctxMode !== 'category';
}
function openCtx(el, x, y) {
  ctxCard = el;
  ctxMode = cardContext(el);
  syncContextActions();
  ctxEl.hidden = false;
  const r = ctxEl.getBoundingClientRect();
  ctxEl.style.left = Math.min(x, innerWidth - r.width - 10) + 'px';
  ctxEl.style.top  = Math.min(y, innerHeight - r.height - 10) + 'px';
}
function closeCtx() { ctxEl.hidden = true; ctxCard = null; ctxMode = 'aggregate'; }

contentEl.addEventListener('contextmenu', e => {
  const card = e.target.closest('.card');
  if (!card) { closeCtx(); return; }
  e.preventDefault();
  openCtx(card, e.clientX, e.clientY);
});
document.addEventListener('click', e => { if (!e.target.closest('#ctxmenu')) closeCtx(); });

$('edit-scrim').hidden = true;
let editingItem = null, movingItem = null;
function openEdit(card) {
  const it = itemOf(card); if (!it) return;
  editingItem = it;
  $('ed-name').value = it.n;
  $('ed-url').value = it.url;
  $('edit-scrim').hidden = false;
  $('ed-name').focus(); $('ed-name').select();
}
$('ed-cancel').addEventListener('click', () => $('edit-scrim').hidden = true);
$('edit-scrim').addEventListener('click', e => { if (e.target === $('edit-scrim')) $('edit-scrim').hidden = true; });
$('ed-save').addEventListener('click', async () => {
  const it = editingItem;
  const n = $('ed-name').value.trim(), u = $('ed-url').value.trim();
  if (!it) return;
  if (!n || !u) { toast('名称和网址不能为空'); return; }
  let url = u;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;   // 无协议的网址补为 HTTPS。
  $('edit-scrim').hidden = true; closeCtx();
  try {
    await extCall(HUB_API.bookmarks, 'update', it.id, { title: n, url });
    toast('已保存到' + BOOKMARK_SOURCE);
  } catch (e) {
    toast('保存失败：' + (e && e.message ? e.message : '未知错误'));
    return;
  }
  refresh();
});

function openMove(card) {
  const it = itemOf(card); if (!it) return;
  movingItem = it;
  const cur = catOf(it);
  const targets = orderedCats().filter(c => !c.virtual && c.key !== cur && !(autoMode() && !c.auto));
  $('pick-list').innerHTML = targets.map(c =>
    `<button data-key="${c.key}">${catIcon(c.name)}<span>${esc(c.name)}</span><span class="cnt">${c.items.length}</span></button>`
  ).join('') || '<p class="hint-line">没有其他可选分类</p>';
  $('move-scrim').hidden = false;
}
$('mv-cancel').addEventListener('click', () => $('move-scrim').hidden = true);
$('move-scrim').addEventListener('click', e => { if (e.target === $('move-scrim')) $('move-scrim').hidden = true; });
$('pick-list').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const it = movingItem; if (!it) return;
  const to = findCat(b.dataset.key);
  $('move-scrim').hidden = true; closeCtx();
  if (!to || to.virtual) return;
  /* 自动分类仅修改本地归属。 */
  if (to.auto) {
    CFG.categoryOverrides = Object.assign({}, CFG.categoryOverrides, { [it.id]: to.key });
    saveCfg(); rebuildCats(); initOrder(); render();
    toast(`已归入「${to.name}」`);
    return;
  }
  try {
    await extCall(HUB_API.bookmarks, 'move', it.id, { parentId: to.folderId, index: 0 });
    toast(`已移动到「${to.name}」`);
  } catch (err) {
    toast('移动失败：' + (err && err.message ? err.message : '未知错误'));
    return;
  }
  refresh();
});

ctxEl.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b || !ctxCard) return;
  const act = b.dataset.act;
  const card = ctxCard;
  const it = itemOf(card);
  if (act === 'edit') { openEdit(card); return; }
  if (act === 'move') { openMove(card); return; }
  if (act === 'favorite-remove') { closeCtx(); removeFromFavorites(it); return; }
  if (act === 'hide-display') { closeCtx(); hideBookmark(it); return; }
  if (act === 'delete') { await deleteBookmarkToTrash(it); }
});

/* 书签拖放由 drag.js 处理。 */

/* 刷新书签和访问频率，保留当前浏览位置。 */
let refreshTimer = null;
function refresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      const tree = await extCall(HUB_API.bookmarks, 'getTree');
      readCats(tree);
      CATS.forEach(c => c.items.forEach(it => { it.freq = FREQ.get(it.h) || 0; }));
      sortByFreq(frequentCat());
    } catch (e) {
      console.error('[bookmarks]', e);
    }
    render();
  }, 120);
}

(async function boot() {
  await cfgReady;
  applyTheme();
  cityInput.value = CFG.city;
  $('search').value = keyword;
  applyHomeChrome();
  try {
    const tree = await extCall(HUB_API.bookmarks, 'getTree');
    readCats(tree);
  } catch (e) {
    console.error('[bookmarks]', e);
    CATS = [];
  }
  contentEl.innerHTML = '<p class="empty-tip">正在读取书签与访问记录…</p>';
  renderNav();
  await loadFrequency();
  CATS.forEach(c => c.items.forEach(it => { it.freq = FREQ.get(it.h) || 0; }));
  sortByFreq(frequentCat());
  render();
  if (initialScrollY > 0) requestAnimationFrame(() => window.scrollTo(0, initialScrollY));
  if (!CFG.legalAccepted) showLegalConsent();
  loadWeather();
  const onChanged = () => refresh();
  try {
    HUB_API.bookmarks.onCreated.addListener(onChanged);
    HUB_API.bookmarks.onRemoved.addListener(onChanged);
    HUB_API.bookmarks.onMoved.addListener(onChanged);
    HUB_API.bookmarks.onChanged.addListener(onChanged);
  } catch (e) {}
})();
