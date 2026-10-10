/* 分类与常用书签管理。 */
(() => {
  const side = document.querySelector('.side');
  const menu = document.createElement('div');
  menu.className = 'ctxmenu organize-menu'; menu.hidden = true;
  document.body.append(menu);
  let selectedCat = null;
  const closeMenu = () => { menu.hidden = true; };
  function modal(title, body) {
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    scrim.innerHTML = `<section class="modal organize-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${body}</section>`;
    const prior = document.activeElement;
    const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey, true); prior?.focus(); };
    function onKey(e) {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); }
      if (e.key === 'Tab') {
        const controls = [...scrim.querySelectorAll('button:not(:disabled),input:not(:disabled)')];
        const first=controls[0], last=controls.at(-1);
        if (e.shiftKey && document.activeElement===first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement===last) { e.preventDefault(); first?.focus(); }
      }
    }
    scrim.addEventListener('click', e => { if (e.target===scrim || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(scrim); scrim.querySelector('input,button')?.focus();
    return {scrim,close};
  }
  const footer = '<div class="modal-acts"><button class="m-btn" data-close>取消</button><button class="m-btn primary" data-save>保存</button></div>';
  side.addEventListener('contextmenu', e => {
    if (e.target.closest('input')) return;
    e.preventDefault(); closeCtx();
    const link = e.target.closest('#nav a[data-key]');
    selectedCat = link ? findCat(link.dataset.key) : null;
    const real = selectedCat && !selectedCat.virtual;
    const writable = real && selectedCat.depth > 0;
    menu.innerHTML = `${real ? `<button data-action="rename" ${writable?'':'disabled'}>重命名分类${writable?'':'（系统目录）'}</button><button class="danger" data-action="delete" ${writable?'':'disabled'}>删除分类及其书签</button><div class="ctx-sep"></div>` : ''}<button data-action="create">新建分类</button>${real ? '<button data-action="child">新建子分类</button>' : ''}<button data-action="sort">调整分类顺序…</button>`;
    menu.hidden=false;
    const rect=menu.getBoundingClientRect();
    menu.style.left=Math.max(8,Math.min(e.clientX,innerWidth-rect.width-8))+'px';
    menu.style.top=Math.max(8,Math.min(e.clientY,innerHeight-rect.height-8))+'px';
  });
  document.addEventListener('click', e => { if (!menu.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', e => { if(e.key==='Escape')closeMenu(); });
  window.addEventListener('resize',closeMenu);
  document.addEventListener('scroll',closeMenu,true);
  async function writableNode(id) {
    const [node] = await HUB_API.bookmarks.get(id);
    if (!node || !node.parentId || node.parentId === '0' || node.unmodifiable) throw new Error('系统或受管理的目录不能修改');
    return node;
  }
  function nameDialog(cat, parentId) {
    const renaming=!!cat;
    const {scrim,close}=modal(renaming?'重命名分类':'新建分类',`<label>分类名称<input id="folder-name" maxlength="120" value="${renaming?esc(cat.name):''}" autocomplete="off"></label><p class="hint-line">将修改${BOOKMARK_SOURCE}中的文件夹。</p>${footer}`);
    const input=scrim.querySelector('input'); input.select();
    const save=scrim.querySelector('[data-save]');
    save.addEventListener('click',async()=>{
      const title=input.value.trim(); if(!title){input.focus();return;}
      save.disabled=true;
      try {
        if(renaming){await writableNode(cat.folderId);await HUB_API.bookmarks.update(cat.folderId,{title});}
        else await HUB_API.bookmarks.create({title,...(parentId?{parentId}:{})});
        close(); refresh(); toast(renaming?'分类已重命名':'分类已创建');
      } catch(e){toast(e.message);save.disabled=false;}
    });
    input.addEventListener('keydown',e=>{if(e.key==='Enter')save.click();});
  }
  let sorting = false, sortDrag = null, gripKey = null, blockSortClick = false;
  const sortBar=document.createElement('div');sortBar.className='side-sort-bar';sortBar.hidden=true;
  sortBar.innerHTML='<span>分类顺序与显示</span><button class="m-btn tiny" data-sort-add>＋ 添加</button><button class="m-btn tiny" data-sort-done>完成</button>';
  const sortHint=document.createElement('p');sortHint.className='side-sort-hint';sortHint.hidden=true;
  sortHint.textContent='拖动左侧手柄调整顺序，点击名称显示 / 隐藏，× 仅移出面板。';
  navEl.before(sortBar);navEl.after(sortHint);
  window.hubDecorateNav = () => {
    if(!sorting)return;
    navEl.querySelectorAll('a[data-key]').forEach(a=>{
      const cat=findCat(a.dataset.key);if(!cat)return;
      a.draggable=true;a.classList.add('side-sort-row');
      a.innerHTML=`<span class="side-sort-handle" role="button" tabindex="0" title="按住拖动调整顺序" aria-label="拖动 ${esc(cat.name)}，也可用方向键上下调整"><svg viewBox="0 0 12 18" aria-hidden="true">${[3,9,15].flatMap(y=>[3,9].map(x=>`<circle cx="${x}" cy="${y}" r="1.4"/>`)).join('')}</svg></span><span class="side-sort-name">${esc(cat.name)}</span><span class="side-sort-count">${cat.items.length}</span>${cat.virtual?'<small class="side-sort-aggregate">聚合</small>':`<button class="side-sort-remove" data-side-remove title="仅移出面板，不删除书签" aria-label="将 ${esc(cat.name)} 移出面板">×</button>`}`;
    });
  };
  function sortDialog() {
    sorting=true;side.classList.add('sorting');sortBar.hidden=sortHint.hidden=false;render();
  }
  sortBar.querySelector('[data-sort-add]').addEventListener('click',openAddCat);
  sortBar.querySelector('[data-sort-done]').addEventListener('click',()=>{
    sorting=false;side.classList.remove('sorting');sortBar.hidden=sortHint.hidden=true;render();
  });
  function clearSortMarks(){navEl.querySelectorAll('.cat-drop-before,.cat-drop-after,.category-dragging').forEach(el=>el.classList.remove('cat-drop-before','cat-drop-after','category-dragging'));}
  navEl.addEventListener('pointerdown',e=>{gripKey=e.target.closest('.side-sort-handle')?.closest('a')?.dataset.key||null;blockSortClick=false;});
  navEl.addEventListener('dragstart',e=>{
    if(!sorting)return;const a=e.target.closest('.side-sort-row');
    if(!a||a.dataset.key!==gripKey){e.preventDefault();return;}
    sortDrag=a.dataset.key;e.dataTransfer.setData('application/x-hub-category',sortDrag);e.dataTransfer.effectAllowed='move';a.classList.add('category-dragging');
  });
  navEl.addEventListener('dragover',e=>{
    if(!sortDrag)return;e.preventDefault();e.stopPropagation();
    navEl.querySelectorAll('.cat-drop-before,.cat-drop-after').forEach(a=>a.classList.remove('cat-drop-before','cat-drop-after'));
    const a=e.target.closest('.side-sort-row');if(!a||a.dataset.key===sortDrag)return;
    const r=a.getBoundingClientRect();a.classList.add(e.clientY<r.top+r.height/2?'cat-drop-before':'cat-drop-after');e.dataTransfer.dropEffect='move';
  });
  navEl.addEventListener('drop',e=>{
    if(!sortDrag)return;e.preventDefault();e.stopPropagation();
    const a=e.target.closest('.side-sort-row'),src=sortDrag;sortDrag=null;gripKey=null;clearSortMarks();
    blockSortClick=true;setTimeout(()=>{blockSortClick=false;},250);
    if(!a||a.dataset.key===src)return;
    initOrder();const order=CFG.order.filter(k=>k!==src),i=order.indexOf(a.dataset.key);if(i<0)return;
    const r=a.getBoundingClientRect();order.splice(i+(e.clientY>=r.top+r.height/2?1:0),0,src);
    CFG.order=order;saveCfg();render();
  });
  navEl.addEventListener('dragend',()=>{sortDrag=null;gripKey=null;clearSortMarks();});
  navEl.addEventListener('keydown',e=>{
    const handle=e.target.closest('.side-sort-handle');if(!handle||!['ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();initOrder();const key=handle.closest('a').dataset.key,i=CFG.order.indexOf(key),j=i+(e.key==='ArrowUp'?-1:1);
    if(j<0||j>=CFG.order.length)return;[CFG.order[i],CFG.order[j]]=[CFG.order[j],CFG.order[i]];saveCfg();render();
    [...navEl.querySelectorAll('.side-sort-row')].find(a=>a.dataset.key===key)?.querySelector('.side-sort-handle')?.focus();
  });
  navEl.addEventListener('click',e=>{
    if(!sorting)return;const a=e.target.closest('.side-sort-row');if(!a)return;
    e.preventDefault();e.stopImmediatePropagation();if(blockSortClick||e.target.closest('.side-sort-handle'))return;
    const key=a.dataset.key;
    if(e.target.closest('[data-side-remove]')){removeCat(key);return;}
    const i=CFG.hidden.indexOf(key);i<0?CFG.hidden.push(key):CFG.hidden.splice(i,1);saveCfg();render();
  },true);
  menu.addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b||b.disabled)return;
    const cat=selectedCat, action=b.dataset.action;closeMenu();
    if(action==='sort'){sortDialog();return;}
    if(action==='create'||action==='child'){nameDialog(null,action==='child'?cat.folderId:bookmarkBarId);return;}
    if(action==='rename'){
      try { const node=await writableNode(cat.folderId);nameDialog({...cat,name:node.title}); }
      catch(err){toast(err.message);}return;
    }
    if(action==='delete'){
      try {
        const node=await writableNode(cat.folderId);
        const [tree]=await HUB_API.bookmarks.getSubTree(node.id);
        let count=0;const countUrls=n=>{if(n.url)count++;(n.children||[]).forEach(countUrls);};countUrls(tree);
        if(!confirm(`从${BOOKMARK_SOURCE}中永久删除「${node.title}」及其全部子文件夹、${count} 个书签？\n这不是仅从面板隐藏，操作无法在导航台撤销。`))return;
        await HUB_API.bookmarks.removeTree(node.id);
        if(currentKey===node.id)currentKey='home';
        refresh();toast('分类及其书签已删除');
      }catch(err){toast('删除失败：'+err.message);}
    }
  });
  function openFavorites() {
    const all=CATS.flatMap(c=>c.items);
    let chosen=new Set(getHomeFavorites().map(it=>it.id));
    const initial=[...chosen];
    const {scrim,close}=modal('自定义常用书签',`<input type="search" placeholder="搜索书签名称或网址" aria-label="搜索可选书签"><p class="hint-line">勾选显示、取消勾选移出常用区，不会删除原书签。可在首页直接拖动排序。首页显示数量在「页面管理」中调整（当前 ${favLimit()} 个），勾选超过时只显示靠前的 ${favLimit()} 个。</p><div class="favorite-choices"></div><div class="modal-acts"><button class="m-btn" data-auto>恢复自动推荐</button><button class="m-btn" data-close>取消</button><button class="m-btn primary" data-save>保存</button></div>`);
    const list=scrim.querySelector('.favorite-choices'), search=scrim.querySelector('input');
    function paint(){const k=search.value.trim().toLowerCase();list.innerHTML=all.filter(it=>(it.n+' '+it.url).toLowerCase().includes(k)).map(it=>`<label class="favorite-choice"><input type="checkbox" value="${esc(it.id)}" ${chosen.has(it.id)?'checked':''}><span><strong>${esc(it.n)}</strong><small>${esc(findCatOf(it)?.name||'')} · ${esc(it.h)}</small></span></label>`).join('')||'<p class="hint-line">没有匹配的书签</p>';}
    search.addEventListener('input',paint);
    list.addEventListener('change',e=>{if(e.target.type==='checkbox')e.target.checked?chosen.add(e.target.value):chosen.delete(e.target.value);});
    scrim.querySelector('[data-save]').addEventListener('click',()=>{const valid=new Set(all.map(it=>it.id));CFG.favoriteIds=[...initial.filter(id=>chosen.has(id)),...[...chosen].filter(id=>!initial.includes(id))].filter(id=>valid.has(id));CFG.favoriteHiddenIds=[];saveCfg();render();close();});
    scrim.querySelector('[data-auto]').addEventListener('click',()=>{CFG.favoriteIds=null;CFG.favoriteHiddenIds=[];saveCfg();render();close();});
    paint();
  }
  contentEl.addEventListener('click',e=>{if(e.target.closest('[data-favorites]'))openFavorites();});

  // 图标动作由 HubIconActions 提供，hires-icons.js 负责菜单入口。
  const file=document.createElement('input');file.type='file';file.accept='image/png,image/jpeg,image/webp';file.hidden=true;document.body.append(file);
  let logoId=null;
  function upload(id){ if(!id) return; logoId=String(id); file.value=''; file.click(); }
  function reset(id){
    id=String(id||'');
    if(!id||!CFG.customLogos||!CFG.customLogos[id]) { toast('当前使用的是网站图标，没有自定义图标可恢复'); return false; }
    const next={...CFG.customLogos}; delete next[id];
    CFG.customLogos=next; saveCfg(); render(); toast('已恢复网站图标');
    return true;
  }
  globalThis.HubIconActions={upload, reset};
  file.addEventListener('change',async()=>{
    const selected=file.files[0],id=logoId;if(!selected||!id)return;
    if(!['image/png','image/jpeg','image/webp'].includes(selected.type)||selected.size>5*1024*1024){toast('请选择 5MB 内的 PNG、JPEG 或 WebP 图标');return;}
    const url=URL.createObjectURL(selected);
    try {
      const image=new Image();image.src=url;await image.decode();
      if(!HubLogos.validSize(image.naturalWidth,image.naturalHeight))throw new Error('图标实际尺寸须至少96×96，且不超过8192px或1600万像素；不放大低清图片');
      const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
      const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      const scale=Math.min(1,128/Math.max(image.naturalWidth,image.naturalHeight)),w=image.naturalWidth*scale,h=image.naturalHeight*scale;
      ctx.drawImage(image,(128-w)/2,(128-h)/2,w,h);
      const next={...(CFG.customLogos||{}),[id]:canvas.toDataURL('image/png')};
      await HUB_API.storage.local.set({cfg:{...CFG,customLogos:next}});CFG.customLogos=next;
      render();toast('高清图标已保存到本机');
      globalThis.dispatchEvent?.(new CustomEvent('hub:icon-saved',{detail:{id}}));
    }catch(err){toast('图标保存失败：'+err.message);}finally{URL.revokeObjectURL(url);}
  });
})();
