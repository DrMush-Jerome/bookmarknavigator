/* WebExtension API 适配。 */
(() => {
  const root = globalThis;
  // 按 storage.local 判断有效命名空间，排除网页中的同名对象。
  const api = [root.browser, root.chrome].find(value => value?.storage?.local) || null;
  root.HUB_LOCAL_LIBRARY = api?.storage?.local && !api?.bookmarks?.getTree
    ? root.HUB_LOCAL_BOOKMARKS.createLibrary(api.storage.local, { locks: root.navigator?.locks }) : null;
  root.HUB_SAFARI_SYNC = root.HUB_LOCAL_LIBRARY && api.runtime?.sendNativeMessage
    ? root.HUB_SAFARI_SYNC_MODULE.create(api, root.HUB_LOCAL_LIBRARY) : null;
  root.HUB_API = root.HUB_LOCAL_LIBRARY ? {
    bookmarks: root.HUB_SAFARI_SYNC?.bookmarks || root.HUB_LOCAL_LIBRARY.bookmarks,
    history: root.HUB_LOCAL_LIBRARY.history,
    storage: api.storage, runtime: api.runtime, permissions: api.permissions,
    tabs: api.tabs, scripting: api.scripting
  } : api;
  if (root.HUB_LOCAL_LIBRARY) api.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes.hubLocalBookmarksV1) root.HUB_LOCAL_LIBRARY.bookmarks.onChanged.emit('local-bar', {});
  });
  root.HUB_BROWSER = api ? (api === root.browser ? 'browser' : 'chrome') : 'preview';
  root.HUB_SAFARI_SYNC?.start();
})();
