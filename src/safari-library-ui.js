/* Safari 本地库界面；在 app.js 之后加载。 */
(() => {
  'use strict';
  const library = globalThis.HUB_LOCAL_LIBRARY;
  if (!library) return;
  const panel = document.getElementById('local-library'); panel.hidden = false;
  document.getElementById('local-library-settings-row').hidden = false;
  document.querySelector('.side-note').textContent = 'Safari 本地书签库';
  document.querySelector('#edit-scrim .hint-line').textContent = '保存到导航台本地书签库，不会修改 Safari 原书签';
  const input = document.getElementById('local-import-file');
  const status = document.getElementById('local-library-status');
  const importButton = document.getElementById('local-import');
  document.getElementById('local-library-help').textContent = '本地导入模式：Safari 26 请使用“文件 > 将浏览数据导出到文件”，仅勾选书签，然后解压 ZIP 并选择其中的 HTML。每次导入新建文件夹，整理只影响本地副本。';
  const sync = globalThis.HUB_SAFARI_SYNC;
  if (sync) {
    document.getElementById('safari-sync-settings').hidden = false;
    const show = state => {
      BOOKMARK_SOURCE = state.active ? 'Safari 原书签' : '导航台本地书签库';
      document.querySelector('.side-note').textContent = state.active ? 'Safari 原书签 · 自动同步' : 'Safari 本地书签库';
      document.querySelector('#edit-scrim .hint-line').textContent = state.active ? '同步模式请在 Safari 中编辑，助手会重新导出读取' : '保存到导航台本地书签库，不会修改 Safari 原书签';
      importButton.disabled = state.active;
      document.getElementById('local-export').textContent = state.active ? '导出本地导入库备份' : '导出本地书签';
      const detail = state.transportError || state.error || (!state.running ? '请打开 macOS 书签导航台 App' : state.busy ? (state.phase || '正在导出或等待删除确认，请查看 Safari 与原生助手') : state.lastDeleteError || (state.active ? '已连接原生助手' : '自动同步未开启，当前使用本地导入库'));
      const when = state.updatedAt ? '；上次成功同步：' + new Date(state.updatedAt).toLocaleString('zh-CN') : '';
      document.getElementById('safari-sync-status').textContent = detail + when;
    };
    sync.addStatusListener(show); show(sync.status());
    document.getElementById('safari-sync-refresh').addEventListener('click', () => sync.read());
  }
  importButton.addEventListener('click', () => { input.value = ''; input.click(); });
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return;
    importButton.disabled = true;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('书签文件不能超过 10 MB');
      const { nodes, skipped } = globalThis.HUB_LOCAL_BOOKMARKS.parseHTML(await file.text());
      await library.importNodes(nodes, '导入 · ' + file.name.replace(/\.html?$/i, ''));
      status.textContent = '导入完成' + (skipped ? `，已跳过 ${skipped} 个不支持的网址` : '');
      refresh();
    } catch (e) { status.textContent = '导入失败：' + e.message; }
    finally { importButton.disabled = false; }
  });
  document.getElementById('local-export').addEventListener('click', async () => {
    try {
      const blob = new Blob([await library.exportHTML()], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'bookmarknavigator-bookmarks-' + new Date().toISOString().slice(0, 10) + '.html';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      status.textContent = '书签已导出；主题、待办和图标设置不包含在此文件中';
    } catch (e) { status.textContent = '导出失败：' + e.message; }
  });
  // 忽略拖动后的抑制点击，仅记录主动打开书签的次数。
  document.getElementById('content').addEventListener('click', e => {
    const card = e.target.closest('a.card[href]');
    if (card && !e.defaultPrevented && e.button === 0) library.recordVisit(card.href).catch(console.error);
  });
})();
