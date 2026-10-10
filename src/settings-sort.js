/* 设置列表拖动预览。 */
(() => {
  'use strict';
  function bind(list, { canDrag = row => row.draggable, fixedTail = [], onCommit }) {
    let active = null, suppressClickUntil = 0;
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rows = () => [...list.children].filter(row => row.matches('li[data-key]'));
    const keys = items => items.map(row => row.dataset.key);
    const equal = (a, b) => a.length === b.length && a.every((key, i) => key === b[i]);
    function positions(order) {
      const current = active.rows, byKey = new Map(current.map(row => [row.dataset.key, row]));
      const gap = current.length > 1 ? Math.max(0, current[1].offsetTop - current[0].offsetTop - current[0].offsetHeight) : 0;
      let top = current[0].offsetTop;
      return new Map(order.map(key => {
        const height = byKey.get(key).offsetHeight, position = { top, height };
        top += height + gap; return [key, position];
      }));
    }
    function preview(clientY) {
      if (!active || !equal(keys(rows()), active.original)) { cancel(); return; }
      const y = clientY - list.getBoundingClientRect().top + list.scrollTop;
      const layout = positions(active.preview), slot = layout.get(active.key);
      // 保留原拖动节点，用预览项标记落点，避免节点位置变化导致抖动。
      if (y >= slot.top && y <= slot.top + slot.height) return;
      const next = active.preview.filter(key => key !== active.key && !fixedTail.includes(key));
      let index = next.findIndex(key => y < layout.get(key).top + layout.get(key).height / 2);
      if (index < 0) index = next.length;
      next.splice(index, 0, active.key);
      next.push(...active.original.filter(key => fixedTail.includes(key)));
      if (equal(next, active.preview)) return;
      active.preview = next;
      const targets = positions(next);
      for (const row of active.rows) {
        const delta = targets.get(row.dataset.key).top - row.offsetTop;
        row.style.transform = `translateY(${delta}px)`;
      }
      list.style.setProperty('--sort-marker-y', `${targets.get(active.key).top - 2}px`);
    }
    function clear() {
      if (!active) return;
      for (const row of active.rows) {
        row.style.transform = active.transforms.get(row);
        row.classList.remove('settings-sort-source', 'dragging');
      }
      list.classList.remove('settings-sorting'); list.style.removeProperty('--sort-marker-y');
      active = null; suppressClickUntil = Date.now() + 250;
    }
    function cancel() { clear(); }
    list.addEventListener('click', e => {
      if (active || Date.now() < suppressClickUntil) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    list.addEventListener('dragstart', e => {
      const row = e.target.closest('li[data-key]');
      if (!row || row.parentElement !== list || !canDrag(row) ||
          e.target.closest('button,input,label,select,a')) { e.preventDefault(); return; }
      cancel();
      const items = rows(), original = keys(items);
      active = { key: row.dataset.key, rows: items, original, preview: original.slice(),
        transforms: new Map(items.map(item => [item, item.style.transform])) };
      e.stopPropagation(); e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', active.key);
      row.classList.add('settings-sort-source', 'dragging');
      list.classList.add('settings-sorting');
      list.style.setProperty('--sort-marker-y', `${row.offsetTop - 2}px`);
    });
    list.addEventListener('dragover', e => {
      if (!active) return;
      e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; preview(e.clientY);
    });
    list.addEventListener('drop', e => {
      if (!active) return;
      e.preventDefault(); e.stopPropagation(); preview(e.clientY);
      if (!active) return;
      const { key, original, preview: next } = active;
      const before = new Map(active.rows.map(row => [row.dataset.key, row.getBoundingClientRect().top]));
      clear();
      if (equal(original, next)) return;
      onCommit(next.slice());
      for (const row of rows()) {
        const delta = before.get(row.dataset.key) - row.getBoundingClientRect().top;
        if (!reduced() && Number.isFinite(delta) && Math.abs(delta) > .5 && row.animate)
          row.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
            { duration: 180, easing: 'cubic-bezier(.2,.75,.25,1)' });
        if (row.dataset.key === key) {
          row.classList.add('settings-sort-landed');
          setTimeout(() => row.classList.remove('settings-sort-landed'), 320);
        }
      }
    });
    list.addEventListener('dragend', cancel);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') cancel(); }, true);
    window.addEventListener('blur', cancel);
    return { cancel, isDragging: () => !!active };
  }
  globalThis.HubSettingsSort = { bind };
})();
