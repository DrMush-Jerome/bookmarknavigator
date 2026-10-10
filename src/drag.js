/* 书签拖放；在 app.js 之后加载。 */
(() => {
  'use strict';

  function moveIndex(children, sourceId, targetId, after) {
    if (sourceId === targetId) return null;
    const at = targetId == null ? children.length : children.findIndex(n => n.id === targetId);
    if (at < 0) throw new Error('目标书签已变化，请刷新后重试');
    const index = at + (targetId != null && after ? 1 : 0);
    const source = children.findIndex(n => n.id === sourceId);
    // Chrome 的目标索引按移动前的位置计算，同目录向后移动无需减一。
    // https://raw.githubusercontent.com/chromium/chromium/main/components/bookmarks/browser/bookmark_model.h
    return source >= 0 && (index === source || index === source + 1) ? null : index;
  }

  function reorderFavorites(ids, sourceId, targetId, after) {
    if (!ids.includes(sourceId)) throw new Error('首页书签已变化，请重试');
    if (sourceId === targetId) return ids.slice();
    const result = ids.filter(id => id !== sourceId);
    const at = targetId == null ? result.length : result.indexOf(targetId);
    if (at < 0) throw new Error('目标书签已变化，请重试');
    result.splice(at + (targetId != null && after ? 1 : 0), 0, sourceId);
    return result;
  }

  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined') module.exports = { moveIndex, reorderFavorites };
    return;
  }

  let active = null, busy = false, clickTimer = null;
  const closest = (el, selector) => el && el.closest ? el.closest(selector) : null;
  const realCat = key => CATS.find(c => c.key === key && c.folderId && !c.virtual);
  const knownItem = id => CATS.some(c => c.items.some(item => item.id === id));
  const aggregateMessage = '此列表按时间或访问频率排序，不能手动重排；可拖到侧栏真实分类';

  function clearMarks() {
    [contentEl, navEl].forEach(root => root.querySelectorAll('.drop-before,.drop-after,.drop-active')
      .forEach(el => el.classList.remove('drop-before', 'drop-after', 'drop-active')));
  }
  function resetClickGuard() {
    clearTimeout(clickTimer);
    suppressClick = false;
  }
  function guardClick() {
    resetClickGuard();
    suppressClick = true;
    clickTimer = setTimeout(() => { suppressClick = false; }, 250);
  }
  function cleanup() {
    if (active) active.card.classList.remove('dragging');
    active = null;
    clearMarks();
  }
  function prepareCards() {
    contentEl.querySelectorAll('.card').forEach(card => { card.draggable = true; });
  }
  prepareCards();
  new MutationObserver(prepareCards).observe(contentEl, { childList: true, subtree: true });
  // 新的按下操作清除上一轮拖动的点击抑制。
  document.addEventListener('pointerdown', resetClickGuard, true);
  document.addEventListener('click', e => {
    if (suppressClick && (closest(e.target, '.card') || navEl.contains(e.target))) {
      e.preventDefault();
      e.stopImmediatePropagation();
      resetClickGuard();
    }
  }, true);

  contentEl.addEventListener('dragstart', e => {
    const card = closest(e.target, '.card');
    const item = card && itemOf(card);
    if (busy || !card || !contentEl.contains(card) || !item || !knownItem(item.id) || !e.dataTransfer) {
      e.preventDefault();
      return;
    }
    cleanup();
    resetClickGuard();
    const favorites = !!closest(card, '.home-favorites');
    const aggregate = !!closest(card, '.recent-list') || currentKey === '@recent' || currentKey === '@frequent';
    active = { id: item.id, card, favorites, aggregate };
    card.classList.add('dragging');
    // 不传递 URL，避免拖动到页面外时打开书签。
    e.dataTransfer.clearData();
    e.dataTransfer.setData('application/x-bookmark-hub-id', item.id);
    e.dataTransfer.effectAllowed = 'move';
    if (aggregate) toast(aggregateMessage);
  });

  function destination(e) {
    const nav = closest(e.target, 'a[data-key]');
    if (nav && navEl.contains(nav)) {
      const cat = realCat(nav.dataset.key);
      if (!cat) return { error: '「全部书签」「最近添加」「最常访问」是聚合视图，请落到具体分类' };
      /* 常用清单独立于文件夹，移动书签不改变常用清单。 */
      return { cat, targetId: null, mark: nav };
    }
    if (!contentEl.contains(e.target)) return null;
    const grid = closest(e.target, '.grid');
    const card = closest(e.target, '.card');
    const home = !!closest(e.target, '.home-favorites');
    if (closest(e.target, '.recent-list') || currentKey === '@recent' || currentKey === '@frequent') {
      return { error: aggregateMessage };
    }
    if (active.favorites || home) {
      if (!active.favorites || !home || !grid) return { error: '首页拖拽仅调整常用书签顺序' };
    } else if (active.aggregate) {
      return { error: aggregateMessage };
    }
    if (!grid) return null;
    const item = card && itemOf(card);
    if (card && !item) return null;
    const after = card ? e.clientX >= card.getBoundingClientRect().left + card.getBoundingClientRect().width / 2 : false;
    if (home) return { favorites: true, targetId: item ? item.id : null, after, mark: card || grid };
    // 落点使用当前分类的文件夹 ID。
    const section = closest(grid, '.sec[data-key]');
    const cat = realCat(section ? section.dataset.key : currentKey);
    if (!cat) return null;
    return { cat, targetId: item ? item.id : null, after, mark: card || grid };
  }

  document.addEventListener('dragover', e => {
    if (!active) return;
    e.preventDefault();
    clearMarks();
    const target = destination(e);
    if (e.dataTransfer) e.dataTransfer.dropEffect = target && !target.error ? 'move' : 'none';
    if (target && !target.error && target.mark !== active.card) {
      target.mark.classList.add(target.targetId == null ? 'drop-active' : target.after ? 'drop-after' : 'drop-before');
    }
  });

  document.addEventListener('drop', async e => {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    const source = active;
    const target = destination(e);
    cleanup();
    guardClick();
    if (!target) return;
    if (target.error) { toast(target.error); return; }
    if (!knownItem(source.id)) { toast('源书签已变化，请刷新后重试'); return; }
    busy = true;
    const switchedToCustom = !!CFG.sortBy && CFG.sortBy !== 'custom';
    try {
      /* 重排时切换到自定义排序并持久化。 */
      if (switchedToCustom) { CFG.sortBy = 'custom'; saveCfg(); }
      if (target.favorites) {
        const ids = Array.isArray(CFG.favoriteIds) ? CFG.favoriteIds : getHomeFavorites().map(item => item.id);
        CFG.favoriteIds = reorderFavorites(ids, source.id, target.targetId, target.after);
        saveCfg();
        render();
        toast('首页书签顺序已调整');
      } else if (target.cat.auto) {
        /* 自动分类的顺序仅保存在本地。 */
        const cat = target.cat, ids = cat.items.map(i => i.id);
        CFG.autoOrder = Object.assign({}, CFG.autoOrder, { [cat.key]: reorderFavorites(ids, source.id, target.targetId, target.after) });
        saveCfg();
        rebuildCats();
        render();
        toast(`「${cat.name}」内的顺序已保存`);
      } else {
        const parentId = target.cat.folderId;
        const children = await extCall(HUB_API.bookmarks, 'getChildren', parentId);
        const index = moveIndex(children, source.id, target.targetId, target.after);
        if (index == null) {
          const same = String(children[children.length - 1] && children[children.length - 1].id) === String(source.id);
          toast(same ? `「${target.cat.name}」已经在这个书签的末尾，无需移动` : '书签位置没有变化');
          return;
        }
        await extCall(HUB_API.bookmarks, 'move', source.id, { parentId, index });
        toast(switchedToCustom ? '书签位置已调整，并已切换到自定义顺序' : '书签位置已调整');
        refresh();
      }
    } catch (err) {
      toast('移动失败：' + (err && err.message ? err.message : '未知错误'));
    } finally {
      busy = false;
    }
  });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) clearMarks(); });
  document.addEventListener('dragend', () => {
    if (active) { cleanup(); guardClick(); }
    else clearMarks();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && active) { cleanup(); guardClick(); }
  }, true);
})();
