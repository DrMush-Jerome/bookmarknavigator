/* 用户授权后从网站读取图标。 */
(() => {
  'use strict';
  function publicOrigin(value) {
    try {
      const u = new URL(value), h = u.hostname.toLowerCase().replace(/\.$/, '');
      if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port) return null;
      // 排除 IP 地址、单段主机名和本地域名。
      if (!h.includes('.') || h.includes(':') || /^[\d.]+$/.test(h) ||
          /(^|\.)(localhost|local|internal|intranet|lan|home|corp|test|invalid|onion)$/.test(h) || h.endsWith('.home.arpa')) return null;
      if (u.hostname.endsWith('.')) return null;
      return u.origin;
    } catch (_) { return null; }
  }
  function inventory(cats, cache = {}) {
    const origins = new Set(), excluded = new Set();
    cats.forEach(c => c.items.forEach(it => {
      const origin = publicOrigin(it.url);
      if (origin) origins.add(origin); else excluded.add(it.url);
    }));
    return { pending: [...origins].filter(o => !cache[o]), cached: [...origins].filter(o => cache[o]), excluded: [...excluded] };
  }
  function sourceURL(value, base) {
    try { const u = new URL(value, base); if (!publicOrigin(u.href)) return null; u.hash = ''; return u.href; } catch (_) { return null; }
  }
  function manifestIcons(text, url) {
    const data = JSON.parse(text);
    return (Array.isArray(data.icons) ? data.icons : []).slice(0, 24).filter(x => x && typeof x.src === 'string').map(x => ({ rel: 'icon', href: sourceURL(x.src, url), sizes: x.sizes })).filter(x => x.href);
  }
  function issue(code, message) { return Object.assign(new Error(message), { code }); }
  function candidates(origin, links, allowed = new Set([origin])) {
    const scores = new Map();
    for (const link of links) {
      if (!/(^|\s)(icon|apple-touch-icon|apple-touch-icon-precomposed)(\s|$)/i.test(link.rel || '')) continue;
      try {
        const u = new URL(link.href, origin + '/');
        if (!publicOrigin(u.href) || !allowed.has(u.origin)) continue;
        u.hash = '';
        const sizes = [...String(link.sizes || '').matchAll(/(?:^|\s)(\d+)x(\d+)(?=\s|$)/gi)];
        const score = /(^|\s)any(\s|$)/i.test(link.sizes || '') || /\.svg$/i.test(u.pathname) ? 10000 : sizes.reduce((n, m) => Math.max(n, Math.min(+m[1], +m[2])), 0);
        scores.set(u.href, Math.max(scores.get(u.href) || 0, score));
      } catch (_) {  }
    }
    const first = [...scores].sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x[0]);
    return [...new Set([...first, ...['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png', '/favicon.svg', '/favicon.ico'].map(p => origin + p)])];
  }
  function rasterSize(w, h) {
    if (!Number.isFinite(w) || !Number.isFinite(h) || Math.min(w, h) < 96 || Math.max(w, h) > 8192 || w * h > 16777216) return null;
    const edge = Math.max(w, h) >= 256 ? 256 : 128;
    const scale = Math.min(1, edge / Math.max(w, h));
    return { edge, width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
  }
  // 网络与图像解码通过 effects 注入，便于独立测试。
  async function optimizeOne(origin, granted, effects, signal) {
    if (!granted) return { state: 'skipped', detail: '未授权，未访问' };
    if (signal.aborted) return { state: 'skipped', detail: '已中止，未访问' };
    // 重新获取失败时保留现有图标。
    try {
      const data = await effects.fetchIcon(origin, signal);
      if (signal.aborted) return { state: 'skipped', detail: '已中止，未保存' };
      await effects.save(origin, data, signal);
      return { state: 'success', detail: '已验证高清栅格或安全矢量，保存成功' };
    } catch (error) {
      return { state: signal.aborted ? 'skipped' : 'failed', detail: signal.aborted ? '已中止' : error.message || '获取失败', ...(error.code ? { reason: error.code } : {}) };
    }
  }
  async function permissionGroups(origins, permissions) {
    const checks = await Promise.all(origins.map(async origin => ({ origin,
      granted: await permissions.contains({ origins: [origin + '/*'] }) })));
    return { pending: checks.filter(x => !x.granted).map(x => x.origin), authorized: checks.filter(x => x.granted).map(x => x.origin) };
  }
  function abortable(promise, signal) {
    return new Promise((resolve, reject) => {
      const cancel = () => { signal.removeEventListener('abort', cancel); reject(new Error('已中止或超时')); };
      signal.addEventListener('abort', cancel, { once: true });
      Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
      if (signal.aborted) { signal.removeEventListener('abort', cancel); cancel(); }
    });
  }
  function pause(ms, signal) {
    return new Promise((resolve, reject) => {
      const finish = () => { signal.removeEventListener('abort', cancel); resolve(); };
      const timer = setTimeout(finish, ms);
      const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(new Error('已中止')); };
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }
  function waitForTab(api, id, origin, signal, timeout = 60000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = error => {
        if (done) return; done = true; clearTimeout(timer);
        api.tabs.onUpdated.removeListener(updated); api.tabs.onRemoved.removeListener(removed);
        signal.removeEventListener('abort', aborted);
        error ? reject(error) : resolve();
      };
      const inspect = tab => {
        if ((tab.pendingUrl && publicOrigin(tab.pendingUrl) !== origin) || (tab.url && tab.url !== 'about:blank' && publicOrigin(tab.url) !== origin)) return finish(new Error('页面已离开本次授权来源，未读取'));
        if (tab.status === 'complete' && publicOrigin(tab.url) === origin) finish();
      };
      const updated = (tabId, change, tab) => { if (tabId === id) inspect(tab); };
      const removed = tabId => { if (tabId === id) finish(new Error('标签页已关闭')); };
      const aborted = () => finish(new Error('已中止'));
      const timer = setTimeout(() => finish(new Error('网页加载超时')), timeout);
      api.tabs.onUpdated.addListener(updated); api.tabs.onRemoved.addListener(removed);
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
      else api.tabs.get(id).then(inspect, error => finish(error));
    });
  }
  function iconMetadata(expectedOrigin) {
    if (location.origin !== expectedOrigin) return null;
    return { origin: location.origin, links: [...document.querySelectorAll('link[rel][href]')].slice(0, 128).map(el => ({ href: el.href, rel: el.rel, sizes: el.getAttribute('sizes') })) };
  }
  function requestAccess(api, origins) {
    // 权限申请需保持点击事件的用户手势上下文。
    if (!api?.permissions?.request) throw new Error('当前页面无法调用扩展权限接口；请从已安装扩展的新标签页操作');
    const manifest = api.runtime.getManifest();
    if (![...(manifest.permissions || []), ...(manifest.optional_permissions || [])].includes('scripting')) {
      throw new Error(`当前加载版本 ${manifest.version} 未声明 scripting 权限。请覆盖完整新版文件后，在扩展管理页点击重新加载，再打开新标签页`);
    }
    return api.permissions.request({ origins: origins.map(o => o + '/*'), permissions: ['scripting'] });
  }
  async function optimizeBatch(origins, permission, api, effects, signal, options = {}) {
    const results = [], exceptions = [], owned = new Map();
    let granted = false, permissionIssue = null;
    try {
      granted = await permission;
      if (!granted) permissionIssue = { kind: 'denied', message: '浏览器返回未批准（permissions.request = false）。可能是取消、拒绝或浏览器策略限制；尚未打开网站，也未尝试下载图标。' };
    } catch (error) {
      permissionIssue = { kind: 'error', message: '权限接口报错：' + (error?.message || String(error)) };
    }
    if (!granted || signal.aborted) return { results: origins.map(origin => ({ origin, state: 'skipped', detail: granted ? '已中止，未打开网页' : permissionIssue.message })), exceptions, permissionIssue };
    const removed = id => { owned.delete(id); };
    const navigated = (id, change, tab) => {
      const entry = owned.get(id);
      if (entry && [change.url, tab.pendingUrl, tab.url].some(url => url && url !== 'about:blank' && publicOrigin(url) !== entry.origin)) entry.left = true;
    };
    api.tabs.onRemoved.addListener(removed); api.tabs.onUpdated.addListener(navigated);
    async function cleanup(id) {
      const entry = owned.get(id); if (!entry) return;
      try {
        const tab = await api.tabs.get(id);
        const urls = [tab.pendingUrl, tab.url].filter(url => url && url !== 'about:blank');
        // 页面 URL 不可读时保留标签页。
        if (entry.left || !urls.length || urls.some(url => publicOrigin(url) !== entry.origin)) {
          exceptions.push(entry.origin + '：页面已导航到其他来源或无法确认当前来源，保留标签页');
        } else await api.tabs.remove(id);
      } catch (e) { if (owned.has(id)) exceptions.push(entry.origin + '：无法确认关闭标签页（' + e.message + '）'); }
      finally { owned.delete(id); }
    }
    let next = 0, activeCount = 0;
    const progress = (origin, phase) => {
      try { options.onProgress?.({ origin, phase, completed: results.length, total: origins.length, active: activeCount, pending: origins.length - next }); } catch (_) { /* 忽略进度回调错误。 */ }
    };
    async function worker() {
      while (next < origins.length) {
        const origin = origins[next++];
        if (signal.aborted) {
          results.push({ origin, state: 'skipped', detail: '已中止，排队站点未打开' });
          progress(origin, '已跳过'); continue;
        }
        activeCount++; progress(origin, '打开页面并等待加载');
        const controller = new AbortController(), cancel = () => controller.abort();
        signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
        // 处理预算从任务进入执行槽时开始计时。
        const timer = setTimeout(cancel, options.timeout ?? 90000);
        let result, id;
        try {
          const tab = await api.tabs.create({ url: origin + '/', active: false });
          if (!Number.isInteger(tab.id)) throw new Error('未返回标签页编号');
          id = tab.id; owned.set(id, { origin, left: false });
          result = await optimizeOne(origin, true, {
            fetchIcon: async (_, localSignal) => {
              await waitForTab(api, id, origin, localSignal, options.loadTimeout ?? 60000);
              progress(origin, '页面已加载，等待图标声明');
              let metadata;
              for (let attempt = 0; attempt < 3; attempt++) {
                if (!await abortable(api.permissions.contains({ origins: [origin + '/*'], permissions: ['scripting'] }), localSignal)) throw new Error('权限已撤销');
                const frames = await abortable(api.scripting.executeScript({ target: { tabId: id, frameIds: [0] }, func: iconMetadata, args: [origin] }), localSignal);
                metadata = frames?.[0]?.result;
                if (!metadata || metadata.origin !== origin) throw new Error('页面来源已变化，未读取图标');
                if (metadata.links?.some(link => /(^|\s)(icon|apple-touch-icon|apple-touch-icon-precomposed|manifest)(\s|$)/i.test(link.rel || '')) || attempt === 2) break;
                await pause(options.metadataDelay ?? 1500, localSignal);
              }
              progress(origin, '下载并验证高清图标');
              return abortable(effects.fetchIcon(origin, localSignal, metadata.links), localSignal);
            }, save: effects.save
          }, controller.signal);
        } catch (e) { result = { state: signal.aborted ? 'skipped' : 'failed', detail: e.message }; }
        finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); if (id !== undefined) await cleanup(id); }
        if (controller.signal.aborted && !signal.aborted && result.state === 'skipped') result = { state: 'failed', detail: '站点处理超时（排队时间不计入）' };
        results.push({ origin, ...result }); activeCount--;
        progress(origin, result.detail);
      }
    }
    try {
      progress('', '排队等待');
      await Promise.all(Array.from({ length: Math.min(2, origins.length) }, () => worker()));
    } finally {
      await Promise.all([...owned.keys()].map(cleanup));
      api.tabs.onRemoved.removeListener(removed); api.tabs.onUpdated.removeListener(navigated);
    }
    return { results, exceptions };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { publicOrigin, inventory, candidates, rasterSize, optimizeOne, boundedFetch, permissionGroups, waitForTab, optimizeBatch, iconMetadata, requestAccess, sourceURL, manifestIcons, safeSVG, decodeRaster, fetchIcon };
    return;
  }

  async function boundedFetch(url, limit, signal) {
    const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' });
    if (!response.ok) { await response.body?.cancel(); throw new Error('HTTP ' + response.status); }
    if (+response.headers.get('content-length') > limit) { await response.body?.cancel(); throw new Error('文件超过大小限制'); }
    if (!response.body) throw new Error('响应无内容');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > limit) { await reader.cancel(); throw new Error('文件超过大小限制'); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    return new Blob(chunks, { type: response.headers.get('content-type') || '' });
  }
  function safeSVG(text) {
    const reject = reason => { throw issue('unsafe-svg', '拒绝不安全或复杂 SVG：' + reason); };
    if (text.length > 262144 || /<!DOCTYPE|<!ENTITY|<\?/i.test(text.replace(/^\s*<\?xml[^?]*\?>/, ''))) reject('大小、实体或处理指令');
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml'), root = doc.documentElement;
    if (doc.querySelector('parsererror') || root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') reject('无效 XML');
    const tags = new Set('svg g defs path rect circle ellipse line polyline polygon linearGradient radialGradient stop clipPath title desc'.split(' '));
    const attrs = new Set('id viewBox width height x y x1 y1 x2 y2 cx cy r rx ry d points fill stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset fill-rule clip-rule opacity fill-opacity stroke-opacity transform gradientTransform gradientUnits spreadMethod offset stop-color stop-opacity clip-path clipPathUnits preserveAspectRatio'.split(' '));
    const nodes = [...root.querySelectorAll('*'), root]; if (nodes.length > 1500) reject('节点过多');
    for (const node of nodes) {
      if (!tags.has(node.localName) || node.namespaceURI !== root.namespaceURI) reject('元素 ' + node.localName);
      for (const attr of [...node.attributes]) {
        if (attr.name === 'xmlns' && node === root && attr.value === root.namespaceURI) continue;
        if (attr.namespaceURI || !attrs.has(attr.name)) reject('属性 ' + attr.name);
        const v = attr.value;
        // 仅接收内联几何 SVG，拒绝外部资源及嵌入图片。
        if (v.length > 65536 || /[\\\u0000-\u001f\u007f]|\/\*|\*\/|[<>]|@/u.test(v)) reject('属性值');
        if (/url\s*\(/i.test(v) && !/^url\(#[A-Za-z_][\w.-]*\)$/.test(v)) reject('外部或复杂引用');
        if (/(?:https?:|data:|javascript:|\/\/)/i.test(v)) reject('外部引用');
      }
    }
    const view = root.getAttribute('viewBox');
    if (view) {
      const a = view.trim().split(/[\s,]+/).map(Number);
      if (a.length !== 4 || !a.every(Number.isFinite) || a[2] <= 0 || a[3] <= 0 || a.some(n => Math.abs(n) > 1000000)) reject('viewBox');
    } else {
      const w = Number(root.getAttribute('width')), h = Number(root.getAttribute('height'));
      if (!(w > 0 && h > 0 && w <= 8192 && h <= 8192)) reject('缺少有效 viewBox 或尺寸');
      root.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
    root.setAttribute('width', '256'); root.setAttribute('height', '256');
    return new XMLSerializer().serializeToString(root);
  }
  async function decodeRaster(blob, signal) {
    // 按文件字节识别图片类型。
    const b = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const png = [137,80,78,71,13,10,26,10].every((v,i) => b[i] === v);
    const jpg = b[0] === 255 && b[1] === 216 && b[2] === 255;
    const webp = String.fromCharCode(...b.slice(0,4)) === 'RIFF' && String.fromCharCode(...b.slice(8,12)) === 'WEBP';
    const ico = b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0;
    let vector = false;
    if (!png && !jpg && !webp && !ico) {
      const text = await blob.text();
      if (!/^\s*(?:<\?xml[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(text)) throw issue('no-source', '内容不是支持的图标格式');
      blob = new Blob([safeSVG(text)], { type: 'image/svg+xml' }); vector = true;
    }
    const url = URL.createObjectURL(new Blob([blob], { type: vector ? 'image/svg+xml' : png ? 'image/png' : jpg ? 'image/jpeg' : webp ? 'image/webp' : 'image/x-icon' }));
    const image = new Image();
    let onAbort;
    try {
      if (signal.aborted) throw new Error('已中止');
      image.src = url;
      await Promise.race([image.decode(), new Promise((_, reject) => {
        onAbort = () => { image.src = ''; reject(new Error('已中止或超时')); };
        signal.addEventListener('abort', onAbort, { once: true });
      })]);
      if (signal.aborted) throw new Error('已中止');
      const s = rasterSize(image.naturalWidth, image.naturalHeight);
      if (!s) throw issue('low-resolution', `实际分辨率不合格：${image.naturalWidth}×${image.naturalHeight}（至少96×96，不放大）`);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = s.edge;
      const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, (s.edge - s.width) / 2, (s.edge - s.height) / 2, s.width, s.height);
      return canvas.toDataURL('image/png');
    } finally { if (onAbort) signal.removeEventListener('abort', onAbort); URL.revokeObjectURL(url); }
  }
  async function fetchIcon(origin, parentSignal, links = [], options = {}) {
    if (!publicOrigin(origin) || publicOrigin(origin) !== origin) throw issue('no-source', '非公开网站来源');
    // 站外来源需在当前弹窗中单独确认。
    const allowed = new Set([origin, ...(options.approved || [])].filter(o => publicOrigin(o) === o));
    const pending = new Set(), errors = [], codes = new Set(), all = links.slice(0, 128);
    const discover = link => {
      if (!/(^|\s)(icon|apple-touch-icon|apple-touch-icon-precomposed|manifest)(\s|$)/i.test(link.rel || '')) return;
      const url = sourceURL(link.href, origin + '/'); if (!url) return;
      const source = new URL(url).origin;
      if (!allowed.has(source)) { pending.add(source); options.onSource?.(source, origin); }
    };
    all.forEach(discover);
    async function attempt(url, limit, decode) {
      const source = publicOrigin(url);
      if (!source || !allowed.has(source)) throw issue('awaiting-permission', '来源未经本次明确授权');
      const controller = new AbortController(), cancel = () => controller.abort();
      parentSignal.addEventListener('abort', cancel, { once: true }); if (parentSignal.aborted) cancel();
      const timer = setTimeout(cancel, options.candidateTimeout ?? 6000);
      try {
        if (options.hasPermission && !await abortable(options.hasPermission(source), controller.signal)) throw issue('awaiting-permission', '来源权限已撤销');
        return await abortable((async () => decode(await (options.fetch || boundedFetch)(url, limit, controller.signal), controller.signal))(), controller.signal);
      } finally { clearTimeout(timer); parentSignal.removeEventListener('abort', cancel); }
    }
    const record = (url, e) => {
      const code = e.code || (/HTTP (404|410)\b/.test(e.message) ? 'no-source' : 'network-failure');
      codes.add(code); errors.push(new URL(url).pathname + '：' + e.message);
    };
    const manifests = [...new Set(all.filter(l => /(^|\s)manifest(\s|$)/i.test(l.rel || '')).map(l => sourceURL(l.href, origin + '/')).filter(Boolean))].slice(0, 2);
    for (const url of manifests) {
      if (parentSignal.aborted) throw issue('network-failure', '已中止或站点超时');
      if (!allowed.has(new URL(url).origin)) continue;
      try {
        const extra = await attempt(url, 128 * 1024, async blob => {
          try { return manifestIcons(await blob.text(), url); } catch (_) { throw issue('no-source', 'manifest 无效'); }
        });
        extra.forEach(discover); all.push(...extra);
      } catch (e) { record(url, e); }
    }
    for (const url of candidates(origin, all, allowed)) {
      if (parentSignal.aborted) throw issue('network-failure', '已中止或站点超时');
      try { return await attempt(url, 2 * 1024 * 1024, options.decode || decodeRaster); }
      catch (e) { record(url, e); }
    }
    const code = pending.size || codes.has('awaiting-permission') ? 'awaiting-permission' : codes.has('network-failure') ? 'network-failure' : codes.has('low-resolution') ? 'low-resolution' : codes.has('unsafe-svg') ? 'unsafe-svg' : 'no-source';
    const labels = { 'awaiting-permission': '等待额外来源授权，请在下方勾选来源后授权并重试', 'low-resolution': '仅找到低清图标', 'network-failure': '网络、超时或图片解码失败', 'unsafe-svg': 'SVG 安全检查未通过', 'no-source': '未找到可用图标来源' };
    throw issue(code, labels[code] + '；' + errors.join('；'));
  }
  let saveQueue = Promise.resolve();
  function save(origin, data, signal) {
    const job = saveQueue.then(async () => {
      if (signal.aborted) throw new Error('已中止');
      // 写入时读取当前 CFG，避免覆盖批处理期间的设置变更。
      const previous = CFG.siteLogos?.[origin];
      CFG.siteLogos = { ...(CFG.siteLogos || {}), [origin]: data };
      try { await HUB_API.storage.local.set({ cfg: { ...CFG, siteLogos: { ...CFG.siteLogos } } }); }
      catch (e) {
        if (CFG.siteLogos?.[origin] === data) {
          if (previous === undefined) delete CFG.siteLogos[origin]; else CFG.siteLogos[origin] = previous;
        }
        throw new Error('本地保存失败：' + e.message);
      }
      render();
    });
    saveQueue = job.catch(() => {}); return job;
  }

  const section = document.createElement('div'); section.className = 'fld hires-section';
  section.innerHTML = '<label>网站图标</label><p class="hint-line" data-bundled-summary></p><button class="m-btn" data-hires-open>管理图标</button><p id="hires-status" class="hint-line" role="status" hidden></p>';
  section.querySelector('[data-bundled-summary]').textContent = `内置${globalThis.BUNDLED_LOGO_COUNT || 0}款高清图标，缺失时显示首字。`;
  const drawer = document.getElementById('set-drawer');
  const mount = document.getElementById('st-icons-content') || drawer;
  mount.append(section);
  const status = section.querySelector('#hires-status');
  let active = null;
  function showDialog(info, item) {
    if (active) { active.focus(); return null; }
    const scoped = item ? `<p class="hires-scope">仅处理：${item.n}（${item.h}）</p>` : '';
    const scrim = document.createElement('div'); scrim.className = 'scrim hires-scrim';
    scrim.innerHTML = `<section class="modal hires-section" role="dialog" aria-modal="true" aria-label="授权获取高清网站图标"><header class="hires-header"><h3>高清网站图标</h3><p class="hires-lead">授权后会在后台打开所选网站，可能使用你已有的登录状态。</p>${scoped}</header><div class="hires-body"><details class="hires-help"><summary><span class="hires-help-label">权限与隐私</span><span class="hires-help-note">仅提取图标，失败保留原图</span></summary><div class="hires-help-body"><p>在当前浏览器窗口后台排队打开所选站点首页 /，同时最多处理 2 个站点，处理完并清理后再打开下一个。每页最多等待加载 60 秒，每站处理总预算 90 秒，排队时间不计入。处理期间请勿关闭此新标签页，可点“中止”安全结束；已保存的图标会保留。</p><p>网页可能使用已有登录状态；扩展只读取图标 link 元数据及 manifest 声明，不读取正文、账号、Cookie 或本地存储。不使用图标聚合服务，不读取 OG 图片。图标及 manifest 下载不携带登录凭据或 Referer。</p><p>站外 CDN 来源会展示关联网站，需另外勾选授权后重试；即使已有浏览器权限，也不会静默访问。拒绝授权不会开始下载。manifest 内新发现的来源可能需要下一轮确认。</p><p>结束仅关闭本次创建且可确认仍在原来源的标签页；已导航到其他来源或无法确认来源的页面会保留。权限持续保留，可在扩展设置撤销。</p><p>仅接受实际至少 96×96 的栅格图标及安全 SVG，不放大低清图。优先使用自定义及已获取的高清图标，再使用离线内置图标；缺失时显示首字，不使用浏览器 favicon。无需运行此功能也可使用内置图标。</p></div></details><div class="hires-toolbar"><p class="hires-toolbar-note" data-summary role="status"></p></div><div data-list>
      <section class="hires-group"><details class="hires-fold" data-fold="retry" open><summary class="hires-group-head"><h4>可重试 · 换来源或再试一次</h4><span class="hires-group-count" data-count="retry"></span><label class="hires-group-all"><input type="checkbox" data-group-all="retry" aria-label="全选可重试站点">全选</label></summary><div class="hires-group-body" data-retry></div></details></section>
      <section class="hires-group"><details class="hires-fold" data-fold="pending" open><summary class="hires-group-head"><h4>未授权 · 需先授权</h4><span class="hires-group-count" data-count="pending"></span><label class="hires-group-all"><input type="checkbox" data-group-all="pending" aria-label="全选未授权站点">全选</label></summary><div class="hires-group-body" data-pending></div></details></section>
      <section class="hires-group"><details class="hires-fold" data-fold="done"><summary class="hires-group-head"><h4>已授权 · 已更新图标</h4><span class="hires-group-count" data-count="done"></span><label class="hires-group-all"><input type="checkbox" data-group-all="done" aria-label="全选已更新站点">全选</label></summary><div class="hires-group-body" data-done></div></details></section>
      <section class="hires-group"><details class="hires-fold" data-fold="failed"><summary class="hires-group-head"><h4>已授权 · 尚未获取到</h4><span class="hires-group-count" data-count="failed"></span><label class="hires-group-all"><input type="checkbox" data-group-all="failed" aria-label="全选未获取站点">全选</label></summary><div class="hires-group-body" data-failed></div></details></section>
      <div class="hires-excluded" data-excluded></div></div><div class="hires-source"></div><div class="hires-result" data-result role="status" hidden></div></div><div class="modal-acts"><button class="m-btn" data-cancel>取消</button><button class="m-btn primary" data-start disabled>授权并优化</button></div></section>`;
    const list = scrim.querySelector('[data-list]'), summary = scrim.querySelector('[data-summary]');
    const start = scrim.querySelector('[data-start]'), cancel = scrim.querySelector('[data-cancel]');
    const groupAlls = [...scrim.querySelectorAll('[data-group-all]')];
    const rows = new Map(), origins = [...info.pending, ...info.cached];
    const history = new Map();
    const RETRYABLE = new Set(['awaiting-permission', 'low-resolution', 'no-source', 'network-failure']);
    const approvedSources = new Set(), sourceRows = new Map();
    const sourcePanel = scrim.querySelector('.hires-source'), sourceTitle = document.createElement('h4'), sourceHint = document.createElement('p'), sourceButton = document.createElement('button');
    sourceTitle.textContent = '额外图标来源';
    sourceHint.className = 'hires-source-note'; sourceHint.textContent = '以下图标来自站外 CDN，需要单独授权后才会访问。';
    sourceButton.className = 'm-btn'; sourceButton.textContent = '授权并重试'; sourceButton.disabled = true;
    sourcePanel.append(sourceTitle, sourceHint, sourceButton); sourcePanel.hidden = true;
    function onSource(source, site) {
      let row = sourceRows.get(source);
      if (!row) {
        const label = document.createElement('label'), input = document.createElement('input'), host = document.createElement('span'), related = document.createElement('span');
        input.type = 'checkbox'; input.disabled = running; label.className = 'hires-source-row';
        host.className = 'hires-source-host'; related.className = 'hires-source-related';
        label.append(input, host, related); sourcePanel.insertBefore(label, sourceButton);
        row = { input, host, related, sites: new Set() }; sourceRows.set(source, row);
        input.addEventListener('change', () => { sourceButton.disabled = running || ![...sourceRows.values()].some(r => r.input.checked); });
      }
      row.sites.add(site); row.host.textContent = source; row.related.textContent = '用于 ' + [...row.sites].join('、');
      sourcePanel.hidden = false;
    }
    sourceButton.addEventListener('click', () => {
      if (running) return;
      const sources = [...sourceRows].filter(([, r]) => r.input.checked).map(([source]) => source);
      const sites = [...new Set(sources.flatMap(source => [...sourceRows.get(source).sites]))];
      if (!sources.length) return;
      let permission;
      try { permission = requestAccess(HUB_API, [...new Set([...sources, ...sites])]); } catch (e) { permission = Promise.reject(e); }
      permission = Promise.resolve(permission).then(granted => { if (granted) sources.forEach(s => approvedSources.add(s)); return granted; });
      begin(sites, permission);
    });
    let controller = new AbortController(), running = false, ready = false;
    const initial = () => {
      const entries = [...rows.values()];
      const selected = entries.filter(r => r.input.checked).length;
      const done = entries.filter(r => r.group === 'done').length;
      summary.textContent = `${selected} / ${origins.length} 已选 · ${done} 已更新` + (info.excluded.length ? ` · 排除 ${info.excluded.length}` : '');
      start.disabled = running || !ready || !selected;
      for (const box of groupAlls) {
        const inGroup = entries.filter(r => r.group === box.dataset.groupAll);
        const n = inGroup.filter(r => r.input.checked).length;
        box.disabled = running || !ready || !inGroup.length;
        box.checked = inGroup.length > 0 && n === inGroup.length;
        box.indeterminate = n > 0 && n < inGroup.length;
      }
    };
    for (const box of groupAlls) {
      box.addEventListener('change', () => {
        if (running || !ready) return;
        rows.forEach(r => { if (r.group === box.dataset.groupAll) r.input.checked = box.checked; });
        initial();
      });
    }
    const reasonLabels = { 'awaiting-permission': '待来源授权', 'low-resolution': '图标清晰度不足', 'no-source': '未找到图标', 'network-failure': '网络或解码失败', 'unsafe-svg': 'SVG 安全检查未通过' };
    function shortOutcome(result) {
      if (result.state === 'success') return '已更新';
      if (result.state === 'skipped') return '已跳过';
      return reasonLabels[result.reason] || (/超时/.test(result.detail) ? '处理超时' : '获取失败');
    }
    function disclosure(title, text) {
      const details = document.createElement('details'), heading = document.createElement('summary'), content = document.createElement('p');
      details.className = 'hires-help'; heading.textContent = title; content.className = 'hires-why-body'; content.textContent = text;
      details.append(heading, content); return details;
    }
    function makeRow(origin, checked) {
      const row = document.createElement('div'), line = document.createElement('div'), label = document.createElement('label'),
        input = document.createElement('input'), name = document.createElement('span'), state = document.createElement('span'),
        why = document.createElement('details'), whyHead = document.createElement('summary'), whyBody = document.createElement('p');
      row.className = 'hires-site'; line.className = 'hires-site-line'; input.type = 'checkbox'; input.value = origin; input.checked = checked;
      label.title = origin; name.className = 'hires-site-name'; name.textContent = origin.startsWith('http:') ? origin : new URL(origin).hostname;
      state.className = 'hires-site-state'; label.append(input, name);
      why.className = 'hires-why'; whyHead.textContent = '查看原因'; whyBody.className = 'hires-why-body';
      why.append(whyHead, whyBody); why.hidden = true;
      line.append(label, state); row.append(line, why);
      return { row, input, state, why, whyBody, group: null };
    }
    function setRowStatus(entry, text, fullText) {
      entry.state.textContent = text || '';
      if (fullText) { entry.why.hidden = false; entry.whyBody.textContent = fullText; }
      else entry.why.hidden = true;
    }
    function bucketOf(origin, granted) {
      if (!granted) return 'pending';
      if (CFG.siteLogos?.[origin] || history.get(origin)?.state === 'success') return 'done';
      return RETRYABLE.has(history.get(origin)?.reason) ? 'retry' : 'failed';
    }
    async function refresh(results = []) {
      ready = false; start.disabled = true; groupAlls.forEach(b => b.disabled = true);
      results.forEach(r => history.set(r.origin, r));
      try {
        const groups = await permissionGroups(origins, HUB_API.permissions);
        const grantedSet = new Set(groups.authorized);
        const buckets = { retry: [], pending: [], done: [], failed: [] };
        origins.forEach(origin => buckets[bucketOf(origin, grantedSet.has(origin))].push(origin));
        for (const group of ['retry', 'pending', 'done', 'failed']) {
          const target = scrim.querySelector(`[data-${group}]`); target.replaceChildren();
          scrim.querySelector(`[data-count="${group}"]`).textContent = buckets[group].length + ' 个';
          const fold = scrim.querySelector(`[data-fold="${group}"]`);
          fold.hidden = !buckets[group].length;
          for (const origin of buckets[group]) {
            const previous = rows.get(origin), result = history.get(origin);
            const entry = makeRow(origin, result ? result.state !== 'success' : previous ? previous.input.checked : !CFG.siteLogos?.[origin]);
            entry.group = group;
            setRowStatus(entry, result ? shortOutcome(result) : CFG.siteLogos?.[origin] ? '已缓存' : group === 'failed' ? '未尝试' : '',
              result && result.state !== 'success' ? result.detail : null);
            target.append(entry.row); rows.set(origin, entry);
          }
          if (!buckets[group].length) { const p = document.createElement('p'); p.className = 'hires-empty'; p.textContent = '暂无'; target.append(p); }
        }
        ready = true; initial();
      } catch (e) { summary.textContent = '无法核实网站权限：' + e.message + '；请关闭后重开'; }
    }
    for (const url of info.excluded) { const p = document.createElement('p'); p.className = 'hint-line'; p.textContent = url + '：已排除（特殊协议、IP、内网或非默认端口）'; scrim.querySelector('[data-excluded]').append(p); }
    list.addEventListener('change', initial); void refresh();
    const prior = document.activeElement;
    const close = () => { if (running) { controller.abort(); cancel.disabled = true; cancel.textContent = '正在中止…'; return; } scrim.remove(); document.removeEventListener('keydown', key, true); active = null; prior?.focus(); };
    function key(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
      if (e.key === 'Tab') {
        const controls = [...scrim.querySelectorAll('button:not(:disabled),input:not(:disabled),summary')].filter(el => {
          if (el.closest('[hidden]') || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') return false;
          for (let parent = el.parentElement; parent && parent !== scrim; parent = parent.parentElement) {
            if (parent.tagName === 'DETAILS' && !parent.open && !parent.querySelector(':scope > summary')?.contains(el)) return false;
          }
          return true;
        }), first = controls[0], last = controls.at(-1);
        if (!controls.includes(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first)?.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }
    cancel.addEventListener('click', close); scrim.addEventListener('click', e => { if (e.target === scrim) close(); });
    document.addEventListener('keydown', key, true); document.body.append(scrim);
    active = { focus: () => cancel.focus() }; cancel.focus();
    function begin(explicitSites, explicitPermission) {
      if (running) return;
      const selected = explicitSites || [...rows].filter(([, r]) => r.input.checked).map(([o]) => o);
      if (!selected.length) return;
      controller = new AbortController(); running = true; start.disabled = true; groupAlls.forEach(b => b.disabled = true); cancel.textContent = '中止';
      scrim.querySelector('[data-result]').hidden = true;
      rows.forEach((r, o) => { r.input.disabled = true; setRowStatus(r, selected.includes(o) ? '等待处理' : '未选择'); });
      sourceButton.disabled = true; sourceRows.forEach(r => { r.input.disabled = true; });
      let permission;
      try {
        // 在 await 之前发起权限申请，保留用户手势。
        permission = explicitPermission || requestAccess(HUB_API, selected);
      } catch (e) { permission = Promise.reject(e); }
      void run(selected, permission);
    }
    async function run(selected, permission) {
      let batch;
      summary.textContent = '等待授权 · 请勿关闭此页，可随时中止。';
      try { batch = await optimizeBatch(selected, permission, HUB_API, { fetchIcon: (origin, signal, links) => fetchIcon(origin, signal, links, {
        approved: approvedSources, onSource, hasPermission: source => HUB_API.permissions.contains({ origins: [source + '/*'] })
      }), save }, controller.signal, {
        onProgress: p => {
          summary.textContent = `已完成 ${p.completed}/${p.total} · 处理中 ${p.active} · 排队 ${p.pending}。请勿关闭此页，可点“中止”结束。`;
          if (p.origin && rows.has(p.origin)) {
            const phases = { '打开页面并等待加载': '加载页面…', '页面已加载，等待图标声明': '读取图标…', '下载并验证高清图标': '验证图标…', '已跳过': '已跳过', '已验证高清栅格或安全矢量，保存成功': '已更新' };
            const short = phases[p.phase] || (/已中止/.test(p.phase) ? '已中止' : /授权|权限/.test(p.phase) ? '权限受限' : /低清|分辨率/.test(p.phase) ? '图标清晰度不足' : /超时/.test(p.phase) ? '处理超时' : '获取失败');
            setRowStatus(rows.get(p.origin), short, phases[p.phase] ? null : p.phase);
          }
        }
      }); }
      catch (e) { batch = { results: selected.map(origin => ({ origin, state: 'failed', detail: e.message })), exceptions: ['流程异常，请检查本批标签页是否仍打开'] }; }
      const count = state => batch.results.filter(r => r.state === state).length;
      const result = scrim.querySelector('[data-result]'), head = document.createElement('p'), detail = document.createElement('p');
      const titleText = batch.permissionIssue ? '未获授权' : controller.signal.aborted ? '已中止' : '优化完成';
      head.className = 'hires-result-head'; head.textContent = titleText;
      result.classList.toggle('is-warn', !!(batch.permissionIssue || batch.exceptions.length));
      const categories = Object.entries(reasonLabels).map(([code, label]) => [label, batch.results.filter(r => r.reason === code).length]);
      categories.push(['其他失败', batch.results.filter(r => r.state === 'failed' && !reasonLabels[r.reason]).length], ['跳过', count('skipped') + origins.length - selected.length]);
      detail.className = 'hires-result-line';
      detail.textContent = [`已更新 ${count('success')}`, ...categories.filter(([, n]) => n).map(([label, n]) => `${label} ${n}`)].join(' · ');
      if (controller.signal.aborted) detail.textContent += ' · 已保存的图标保留';
      if (batch.permissionIssue) detail.textContent = '未打开网站，原有图标不变。';
      result.replaceChildren(head, detail);
      if (batch.permissionIssue) {
        result.append(disclosure('权限详情', batch.permissionIssue.message + ` 诊断：扩展 ${HUB_API.runtime.getManifest().version} · ${location.protocol} · 所选站点 ${selected.length} 个。请确认扩展管理页已重新加载完整新版；在浏览器权限弹窗选择允许。如果仍无授权弹窗或全被跳过，请提供本结果框的完整提示（不要提供密码或验证码）。`));
      }
      if (batch.exceptions.length) {
        const warning = document.createElement('p'); warning.className = 'hires-result-line';
        warning.textContent = '部分标签页可能仍保留，请检查。';
        result.append(warning, disclosure(`标签页关闭例外（${batch.exceptions.length}）`, batch.exceptions.join('\n')));
      }
      result.hidden = false; status.hidden = false;
      status.textContent = batch.permissionIssue ? '未获授权，原有图标不变。' : `${titleText} · 已更新 ${count('success')} 个图标`;
      if (batch.exceptions.length) status.textContent += ' · 请检查保留的标签页';
      running = false; cancel.disabled = false; cancel.textContent = '关闭';
      sourceRows.forEach(r => { r.input.disabled = false; r.input.checked = false; });
      sourceButton.disabled = true;
      await refresh(batch.results);
    }
    start.addEventListener('click', () => begin());
    return { begin };
  }
  section.querySelector('[data-hires-open]').addEventListener('click', () => showDialog(inventory(CATS, CFG.siteLogos)));
  const contextButton = document.createElement('button');
  contextButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="9" cy="9" r="1.6"/><path d="m4.5 17 4.8-4.8a1.6 1.6 0 0 1 2.3 0l3 3"/><path d="m14.5 14.5 1.6-1.6a1.6 1.6 0 0 1 2.3 0l1.6 1.6"/></svg>管理图标';
  contextButton.title = '单个书签的图标管理：查看来源、从原站获取、上传本地图标或恢复网站图标';
  ctxEl.append(contextButton);
  contextButton.addEventListener('click', () => {
    const item = itemOf(ctxCard), origin = publicOrigin(item?.url); closeCtx();
    if (!item) return;
    showSiteDialog(item, origin);
  });

  function iconSourceLabel(item, origin) {
    const id = String(item.id);
    if (CFG.customLogos?.[id]) return '自定义图标（本机上传）';
    if (origin && CFG.siteLogos?.[origin]) return '已从网站获取的高清图标';
    const bundled = HubLogos.candidates(item, CFG)[0];
    if (bundled) return '内置离线图标';
    return '首字占位';
  }
  function showSiteDialog(item, origin) {
    if (active) { active.focus(); return; }
    const actions = globalThis.HubIconActions || {};
    const scrim = document.createElement('div'); scrim.className = 'scrim hires-scrim';
    const fav = HubLogos.candidates(item, CFG)[0];
    const preview = fav
      ? `<span class="ico" data-logo-tone="light"><img class="fav" src="${fav}" alt=""></span>`
      : `<span class="ico" style="background:${item.c}">${ini(item.n)}</span>`;
    scrim.innerHTML = `<section class="modal hires-section hires-site-modal" role="dialog" aria-modal="true" aria-label="管理书签图标"><header class="hires-header"><h3>管理图标</h3><p class="hires-lead">当前书签的图标来源、上传与获取都在这里完成。</p></header><div class="hires-body"><div class="hires-site-card"><span class="hires-site-preview">${preview}</span><div class="hires-site-meta"><strong>${item.n}</strong><small>${item.h}</small><small data-source>${iconSourceLabel(item, origin)}</small></div></div>${origin ? '' : '<p class="hint-line">该网址为特殊协议、IP、内网名称或非默认端口，已排除，不会访问。</p>'}<div class="hires-site-actions"><button class="m-btn primary" data-fetch${origin ? '' : ' disabled'}>从原站获取高清图标</button><button class="m-btn" data-upload>上传本地图标…</button><button class="m-btn" data-reset>恢复网站图标</button></div><p class="hint-line">从原站获取需要授权：会在后台打开该站首页并读取图标声明；失败时保留现有图标。自定义与恢复都只影响这个书签，不影响同站其他书签。</p></div><div class="modal-acts"><button class="m-btn" data-close>关闭</button></div></section>`;
    const refreshMeta = () => { scrim.querySelector('[data-source]').textContent = iconSourceLabel(item, origin); };
    const close = () => { document.removeEventListener('keydown', onKey, true); scrim.remove(); active = null; };
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } }
    scrim.querySelector('[data-close]').addEventListener('click', close);
    scrim.addEventListener('click', e => { if (e.target === scrim) close(); });
    scrim.querySelector('[data-upload]').addEventListener('click', () => {
      const pick = () => { refreshMeta(); };
      const done = actions.upload(String(item.id));
      if (done === false) return;
      globalThis.addEventListener?.('hub:icon-saved', pick, { once: true });
    });
    scrim.querySelector('[data-reset]').addEventListener('click', () => { actions.reset(String(item.id)); refreshMeta(); });
    scrim.querySelector('[data-fetch]').addEventListener('click', () => {
      close();
      showDialog({ pending: CFG.siteLogos?.[origin] ? [] : [origin], cached: CFG.siteLogos?.[origin] ? [origin] : [], excluded: [] }, item);
    });
    document.addEventListener('keydown', onKey, true); document.body.append(scrim);
    active = { focus: () => scrim.querySelector('[data-close]').focus() }; active.focus();
  }
})();
