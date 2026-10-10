/* 离线图标选择。 */
(() => {
  'use strict';
  function bundledPath(url, catalog = globalThis.BUNDLED_LOGOS || {}) {
    try {
      const u = new URL(url);
      if (!['https:', 'http:'].includes(u.protocol)) return '';
      const path = catalog[u.hostname.toLowerCase()];
      return typeof path === 'string' && /^logos\/[a-z0-9_-]+\.(png|svg|webp)$/.test(path) ? path : '';
    } catch (_) { return ''; }
  }
  function localRaster(value) {
    return typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value) ? value : '';
  }
  function candidates(item, cfg, catalog) {
    let cached = '';
    try { const u = new URL(item.url); if (['http:', 'https:'].includes(u.protocol)) cached = localRaster(cfg.siteLogos?.[u.origin]); } catch (_) {  }
    return [...new Set([localRaster(cfg.customLogos?.[item.id]), cached, bundledPath(item.url, catalog)].filter(Boolean))];
  }
  function validSize(width, height) {
    return Number.isFinite(width) && Number.isFinite(height) && Math.min(width, height) >= 96 && Math.max(width, height) <= 8192 && width * height <= 16777216;
  }
  const api = { bundledPath, candidates, validSize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.HubLogos = api;
})();
