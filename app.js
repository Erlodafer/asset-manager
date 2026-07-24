let TOKEN = '', USER = '', REPOS = [], currentRepo = null, currentPath = '', selectedFiles = [];
let ALL_GISTS = [], editingGistId = null, gistToDelete = null;
let selectedItems = new Map(); // path -> {path, type, name, sha}
let currentFolderItems = []; // items crudos de la carpeta actual, para filtrar sin recargar
let currentSearchQuery = '';

function save(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
function load(k){ try{ return localStorage.getItem(k)||''; }catch(e){ return ''; } }

async function api(path, opts={}){
  const r = await fetch('https://api.github.com'+path, {
    headers:{ Authorization:'token '+TOKEN, Accept:'application/vnd.github+json', 'Content-Type':'application/json', ...opts.headers },
    ...opts
  });
  if(!r.ok){ const e = await r.json().catch(()=>({})); throw new Error(e.message||r.status); }
  if(r.status===204) return {};
  return r.json();
}

async function doLogin(){
  TOKEN = document.getElementById('token-input').value.trim();
  if(!TOKEN){ showToast('Ingresá tu token','error'); return; }
  try {
    const u = await api('/user');
    USER = u.login;
    save('gh_token', TOKEN);
    save('gh_user', USER);
    startApp();
  } catch(e){ showToast('Token inválido: '+e.message,'error'); }
}

function logout(){
  save('gh_token',''); save('gh_user','');
  TOKEN=''; USER='';
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('app').style.display='none';
}

async function startApp(){
  document.getElementById('login-screen').style.display='none';
  document.getElementById('app').style.display='block';
  document.getElementById('user-badge').textContent='@'+USER;
  await loadRepos();
}

/* ── NAVEGACIÓN ── */
function switchView(view){
  document.getElementById('repos-view').style.display = view==='repos' ? 'flex' : 'none';
  document.getElementById('gists-view').style.display = view==='gists' ? 'block' : 'none';
  document.getElementById('nav-repos').classList.toggle('active', view==='repos');
  document.getElementById('nav-gists').classList.toggle('active', view==='gists');
  if(view==='gists' && ALL_GISTS.length===0) loadGists();
}

/* ── REPOSITORIOS ── */
async function loadRepos(){
  const list = document.getElementById('repo-list');
  list.innerHTML='<div class="loading"><div class="spinner"></div>Cargando...</div>';
  try {
    REPOS = await api('/user/repos?per_page=100&sort=updated');
    renderRepoList();
  } catch(e){ list.innerHTML='<div class="loading">Error: '+e.message+'</div>'; }
}

function renderRepoList(){
  const list = document.getElementById('repo-list');
  if(!REPOS.length){ list.innerHTML='<div style="padding:1rem;color:var(--muted);font-size:13px;">No hay repositorios</div>'; return; }
  list.innerHTML = REPOS.map(r=>`
    <div class="repo-item ${currentRepo===r.name?'active':''}" onclick="openRepo('${r.name}')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
      <span class="repo-name">${r.name}</span>
      <span class="repo-vis">${r.private?'privado':'público'}</span>
    </div>
  `).join('');
}

async function openRepo(name){
  currentRepo = name; currentPath = '';
  renderRepoList();
  await loadFiles();
}

async function loadFiles(path=''){
  currentPath = path;
  const main = document.getElementById('main-content');
  main.innerHTML = '<div class="loading"><div class="spinner"></div>Cargando archivos...</div>';
  try {
    const items = await api(`/repos/${USER}/${currentRepo}/contents/${path}`);
    renderFiles(Array.isArray(items)?items:[items], path);
  } catch(e){
    if(e.message.includes('This repository is empty')){
      renderFiles([], path);
    } else {
      main.innerHTML='<div class="loading">Error: '+e.message+'</div>';
    }
  }
}

function renderFiles(items, path){
  selectedItems.clear(); // resetear selección al navegar
  currentFolderItems = items;
  currentSearchQuery = '';

  const breadcrumbs = ['<span onclick="loadFiles(\'\')">'+currentRepo+'</span>'];
  const pathParts = path ? path.split('/') : [];
  if(path){ let acc=''; pathParts.forEach(p=>{ acc+=(acc?'/':'')+p; breadcrumbs.push('<span onclick="loadFiles(\''+acc+'\')">'+p+'</span>'); }); }
  const parentPath = pathParts.slice(0,-1).join('/');

  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="main-header">
      <div>
        <h3>${currentRepo}</h3>
        <div class="breadcrumb">
          ${path ? `<button class="btn" style="padding:3px 10px;font-size:12px;margin-right:6px;" onclick="loadFiles('${parentPath}')">← Volver</button>` : ''}
          ${breadcrumbs.join(' / ')}
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-blue" onclick="openUploadModal('${currentRepo}','${path}')">⬆️ Subir</button>
        <button class="btn" onclick="openNewFileModal('${currentRepo}','${path}')">📄 Crear archivo</button>
        <button class="btn" onclick="openNewFolderModal('${currentRepo}','${path}')">📁 Nueva carpeta</button>
        <button class="btn btn-red" style="border-color:var(--red)" onclick="openDelRepoModal('${currentRepo}')">🗑️ Eliminar repo</button>
      </div>
    </div>
    <div style="position:relative;max-width:320px;margin-bottom:12px;">
      <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:13px;pointer-events:none;">🔍</span>
      <input type="text" id="file-search-input" placeholder="Buscar archivos o carpetas..." style="padding-left:30px;width:100%;" oninput="onFileSearchInput(this.value)" />
    </div>
    <div class="bulk-bar" id="bulk-bar">
      <span class="bulk-bar-text" id="bulk-bar-text">0 seleccionados</span>
      <div class="bulk-bar-actions">
        <button class="btn" onclick="clearSelection()">Cancelar selección</button>
        <button class="btn btn-red" onclick="openBulkDeleteModal()">🗑️ Eliminar seleccionados</button>
      </div>
    </div>
    <div id="file-table-container"></div>
  `;
  renderFileTable(items, path, false);
}

function onFileSearchInput(query){
  currentSearchQuery = query;
  const q = query.trim().toLowerCase();
  const filtered = !q ? currentFolderItems : currentFolderItems.filter(i=>i.name.toLowerCase().includes(q));
  selectedItems.clear();
  renderFileTable(filtered, currentPath, !!q);
}

function renderFileTable(items, path, isFiltered){
  const folders = items.filter(i=>i.type==='dir').sort((a,b)=>a.name.localeCompare(b.name));
  const files = items.filter(i=>i.type==='file').sort((a,b)=>a.name.localeCompare(b.name));
  const all = [...folders, ...files];
  const repo = REPOS.find(r=>r.name===currentRepo)||{};
  const isPublic = !repo.private;

  const container = document.getElementById('file-table-container');
  if(!container) return;

  if(!all.length){
    container.innerHTML = isFiltered
      ? `<div class="empty-state"><p>No se encontraron coincidencias para "${escapeAttr(currentSearchQuery)}"</p></div>`
      : `<div class="empty-state"><p>Este directorio está vacío</p></div>`;
    updateBulkBar();
    return;
  }

  container.innerHTML = `
    <table class="file-table">
      <thead><tr>
        <th class="select-col"><input type="checkbox" id="select-all-checkbox" onchange="toggleSelectAll(this.checked)"></th>
        <th>Nombre</th>
        <th>Tamaño</th>
        ${isPublic?'<th>URL Raw para Singular</th>':'<th>Visibilidad</th>'}
        <th style="text-align:right">Acciones</th>
      </tr></thead>
      <tbody>
        ${(path && !isFiltered)?`<tr><td></td><td colspan="4"><div class="file-name" onclick="loadFiles('${path.split('/').slice(0,-1).join('/')}')">📁 ..</div></td></tr>`:''}
        ${all.map(item=>{
          if(item.type==='dir'){
            return `<tr>
              <td class="select-col"><input type="checkbox" class="row-checkbox" data-path="${item.path}" data-type="folder" data-name="${escapeAttr(item.name)}" data-sha="" onchange="onRowCheckboxChange(this)"></td>
              <td><div class="file-name" onclick="loadFiles('${item.path}')">📁 ${item.name}<span class="tag tag-folder">carpeta</span></div></td>
              <td class="size-text">—</td>
              <td class="size-text">—</td>
              <td><div class="td-actions">
                <button class="icon-btn" title="Renombrar carpeta" onclick="openRenameModal('folder','${item.path}','${item.name}')">🏷️</button>
                <button class="icon-btn danger" title="Eliminar carpeta" onclick="deleteFolder('${item.path}')">🗑️</button>
              </div></td>
            </tr>`;
          }
          const rawUrl = `https://raw.githubusercontent.com/${USER}/${currentRepo}/main/${item.path}`;
          const ext = item.name.split('.').pop();
          return `<tr>
            <td class="select-col"><input type="checkbox" class="row-checkbox" data-path="${item.path}" data-type="file" data-name="${escapeAttr(item.name)}" data-sha="${item.sha}" onchange="onRowCheckboxChange(this)"></td>
            <td><div class="file-name" onclick="window.open('${item.html_url}','_blank')">📄 ${item.name} <span class="file-ext">.${ext}</span></div></td>
            <td class="size-text">${formatSize(item.size)}</td>
            <td>${isPublic?`<div class="url-cell"><span class="url-text" title="${rawUrl}">${rawUrl}</span><button class="copy-btn" onclick="copyUrl('${rawUrl}',this)">Copiar</button></div>`:'<span style="color:var(--yellow);font-size:12px;">⚠️ Repo privado</span>'}</td>
            <td><div class="td-actions">
              <button class="icon-btn" title="Renombrar archivo" onclick="openRenameModal('file','${item.path}','${item.name}','${item.sha}')">🏷️</button>
              ${/\.(json|txt|csv|js|html|css|xml|md|svg)$/i.test(item.name)?`<button class="icon-btn" title="Editar en GitHub" onclick="window.open('https://github.com/${USER}/${currentRepo}/edit/main/${item.path}','_blank')">✏️</button>`:''}
              <button class="icon-btn" title="Descargar" onclick="downloadFile('${rawUrl}','${item.name}')">⬇️</button>
              <button class="icon-btn danger" title="Eliminar" onclick="deleteFile('${item.path}','${item.sha}')">🗑️</button>
            </div></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  updateBulkBar();
}

function formatSize(bytes){
  if(!bytes) return '—';
  if(bytes<1024) return bytes+'B';
  if(bytes<1048576) return (bytes/1024).toFixed(1)+'KB';
  return (bytes/1048576).toFixed(1)+'MB';
}

function copyUrl(url, btn){
  navigator.clipboard.writeText(url).then(()=>{
    btn.textContent='✓ Copiado'; btn.classList.add('copied');
    setTimeout(()=>{ btn.textContent='Copiar'; btn.classList.remove('copied'); },2000);
  });
}

function downloadFile(url, name){
  const a = document.createElement('a');
  a.href = url; a.download = name; a.target='_blank';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

async function deleteFile(path, sha){
  if(!confirm('¿Eliminar "'+path+'"?')) return;
  try {
    await api(`/repos/${USER}/${currentRepo}/contents/${path}`,{
      method:'DELETE', body:JSON.stringify({ message:'Delete '+path, sha })
    });
    showToast('Archivo eliminado','success');
    loadFiles(currentPath);
  } catch(e){ showToast('Error: '+e.message,'error'); }
}

async function deleteFolder(path){
  if(!confirm('¿Eliminar toda la carpeta "'+path+'" y su contenido?')) return;
  try {
    const items = await api(`/repos/${USER}/${currentRepo}/contents/${path}`);
    for(const item of items){
      if(item.type==='file'){
        await api(`/repos/${USER}/${currentRepo}/contents/${item.path}`,{
          method:'DELETE', body:JSON.stringify({ message:'Delete '+item.path, sha:item.sha })
        });
      }
    }
    showToast('Carpeta eliminada','success');
    loadFiles(currentPath);
  } catch(e){ showToast('Error: '+e.message,'error'); }
}

/* ── SELECCIÓN MÚLTIPLE Y BORRADO MASIVO ── */
function onRowCheckboxChange(cb){
  const { path, type, name, sha } = cb.dataset;
  if(cb.checked){ selectedItems.set(path, { path, type, name, sha }); }
  else { selectedItems.delete(path); }
  updateBulkBar();
}

function toggleSelectAll(checked){
  document.querySelectorAll('.row-checkbox').forEach(cb=>{
    cb.checked = checked;
    onRowCheckboxChange(cb);
  });
}

function clearSelection(){
  selectedItems.clear();
  document.querySelectorAll('.row-checkbox').forEach(cb=>cb.checked=false);
  updateBulkBar();
}

function updateBulkBar(){
  const bar = document.getElementById('bulk-bar');
  if(!bar) return;
  const count = selectedItems.size;
  bar.classList.toggle('show', count>0);
  const text = document.getElementById('bulk-bar-text');
  if(text) text.textContent = count+' elemento'+(count!==1?'s':'')+' seleccionado'+(count!==1?'s':'');
  const rowCbs = document.querySelectorAll('.row-checkbox');
  const selectAllCb = document.getElementById('select-all-checkbox');
  if(selectAllCb) selectAllCb.checked = rowCbs.length>0 && count===rowCbs.length;
}

function openBulkDeleteModal(){
  if(!selectedItems.size) return;
  const list = document.getElementById('bulk-delete-list');
  list.innerHTML = Array.from(selectedItems.values()).map(i=>
    `<div>${i.type==='folder'?'📁':'📄'} ${i.name}</div>`
  ).join('');
  document.getElementById('del-bulk-modal').classList.add('open');
}

async function doBulkDelete(){
  const items = Array.from(selectedItems.values());
  if(!items.length) return;
  const btn = document.getElementById('bulk-delete-confirm-btn');
  btn.disabled = true; btn.textContent = 'Eliminando...';

  let ok = 0, fail = 0;
  for(const item of items){
    try {
      if(item.type==='file'){
        await api(`/repos/${USER}/${currentRepo}/contents/${item.path}`,{
          method:'DELETE', body:JSON.stringify({ message:'Delete '+item.path, sha:item.sha })
        });
      } else {
        const contents = await api(`/repos/${USER}/${currentRepo}/contents/${item.path}`);
        const filesInFolder = Array.isArray(contents) ? contents.filter(i=>i.type==='file') : [];
        for(const f of filesInFolder){
          await api(`/repos/${USER}/${currentRepo}/contents/${f.path}`,{
            method:'DELETE', body:JSON.stringify({ message:'Delete '+f.path, sha:f.sha })
          });
        }
      }
      ok++;
    } catch(e){ fail++; }
  }

  btn.disabled = false; btn.textContent = 'Eliminar todo';
  closeModal('del-bulk-modal');
  showToast(ok+' elemento(s) eliminado(s)'+(fail?`, ${fail} con error`:''), fail?'error':'success');
  loadFiles(currentPath);
}

function openUploadModal(repo, path){
  const sel = document.getElementById('upload-repo');
  sel.innerHTML = REPOS.map(r=>`<option value="${r.name}" ${r.name===repo?'selected':''}>${r.name}</option>`).join('');
  document.getElementById('upload-path').value = path||'';
  document.getElementById('file-selected-list').innerHTML='';
  document.getElementById('progress-bar').style.display='none';
  const replaceRadio = document.querySelector('input[name="upload-conflict-mode"][value="replace"]');
  if(replaceRadio) replaceRadio.checked = true;
  selectedFiles=[];
  document.getElementById('upload-modal').classList.add('open');
}

function onFilesSelected(files){
  selectedFiles = Array.from(files);
  refreshFileConflictPreview();
}

let pathDebounceTimer;
function onUploadPathInput(){
  clearTimeout(pathDebounceTimer);
  pathDebounceTimer = setTimeout(refreshFileConflictPreview, 500);
}

/* Consulta cuáles de los archivos seleccionados ya existen en el destino,
   para mostrar de una vez si se van a reemplazar o subir como nuevos. */
async function refreshFileConflictPreview(){
  const list = document.getElementById('file-selected-list');
  if(!selectedFiles.length){ list.innerHTML=''; return; }
  const repo = document.getElementById('upload-repo').value;
  const pathPrefix = document.getElementById('upload-path').value.trim().replace(/\/$/,'');

  list.innerHTML = selectedFiles.map((f,i)=>
    `<div id="conflict-row-${i}">📄 ${f.name} (${formatSize(f.size)}) <span style="color:var(--muted);">— comprobando...</span></div>`
  ).join('');

  selectedFiles.forEach(async (f,i)=>{
    const filePath = pathPrefix ? `${pathPrefix}/${f.name}` : f.name;
    let exists = false;
    try { await api(`/repos/${USER}/${repo}/contents/${filePath}`); exists = true; } catch(e){ exists = false; }
    const row = document.getElementById('conflict-row-'+i);
    if(!row) return;
    row.innerHTML = exists
      ? `📄 ${f.name} (${formatSize(f.size)}) <span style="color:var(--yellow);">— 🔄 ya existe</span>`
      : `📄 ${f.name} (${formatSize(f.size)}) <span style="color:var(--accent);">— 🆕 nuevo</span>`;
  });
}

const dz = document.getElementById('drop-zone');
dz.addEventListener('dragover',e=>{ e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave',()=>dz.classList.remove('drag-over'));
dz.addEventListener('drop',e=>{
  e.preventDefault(); dz.classList.remove('drag-over');
  onFilesSelected(e.dataTransfer.files);
});

async function doUpload(){
  if(!selectedFiles.length){ showToast('Seleccioná archivos primero','error'); return; }
  const repo = document.getElementById('upload-repo').value;
  const pathPrefix = document.getElementById('upload-path').value.trim().replace(/\/$/,'');
  const conflictMode = document.querySelector('input[name="upload-conflict-mode"]:checked').value; // 'replace' | 'skip'
  const pb = document.getElementById('progress-bar');
  const pf = document.getElementById('progress-fill');
  pb.style.display='block'; pf.style.width='0%';
  let uploaded=0, replaced=0, skipped=0, errors=0;
  let done=0;
  for(const file of selectedFiles){
    const filePath = pathPrefix ? `${pathPrefix}/${file.name}` : file.name;
    let sha='';
    try { const ex = await api(`/repos/${USER}/${repo}/contents/${filePath}`); sha=ex.sha; } catch(e){}

    if(sha && conflictMode==='skip'){
      skipped++;
      done++; pf.style.width=((done/selectedFiles.length)*100)+'%';
      continue;
    }

    try {
      const base64 = await toBase64(file);
      await api(`/repos/${USER}/${repo}/contents/${filePath}`,{
        method:'PUT', body:JSON.stringify({ message:`Upload ${file.name}`, content:base64, ...(sha?{sha}:{}) })
      });
      uploaded++;
      if(sha) replaced++;
    } catch(e){ errors++; showToast('Error subiendo '+file.name+': '+e.message,'error'); }
    done++; pf.style.width=((done/selectedFiles.length)*100)+'%';
  }
  closeModal('upload-modal');
  const parts = [];
  parts.push(uploaded+' subido(s)'+(replaced?` (${replaced} reemplazado(s))`:''));
  if(skipped) parts.push(skipped+' omitido(s) por ya existir');
  if(errors) parts.push(errors+' con error');
  showToast(parts.join(', '), errors?'error':'success');
  if(currentRepo===repo) loadFiles(currentPath);
}

function toBase64(file){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=e=>res(e.target.result.split(',')[1]);
    r.onerror=rej;
    r.readAsDataURL(file);
  });
}

function openNewRepoModal(){
  document.getElementById('new-repo-name').value='';
  document.getElementById('new-repo-desc').value='';
  document.getElementById('new-repo-public').checked=true;
  document.getElementById('new-repo-readme').checked=true;
  document.getElementById('new-repo-pages').checked=true;
  document.getElementById('pages-label').style.opacity='1';
  document.getElementById('pages-warning').style.display='none';
  document.getElementById('pages-noreadme-warning').style.display='none';
  document.getElementById('new-repo-modal').classList.add('open');
}

function togglePagesCheck(){
  const isPublic = document.getElementById('new-repo-public').checked;
  document.getElementById('pages-label').style.opacity = isPublic ? '1' : '0.5';
  document.getElementById('pages-warning').style.display = isPublic ? 'none' : 'block';
  if(!isPublic) document.getElementById('new-repo-pages').checked = false;
}

function toggleReadmeCheck(){
  const hasReadme = document.getElementById('new-repo-readme').checked;
  const pagesCheckbox = document.getElementById('new-repo-pages');
  document.getElementById('pages-label').style.opacity = hasReadme ? '1' : '0.5';
  document.getElementById('pages-noreadme-warning').style.display = hasReadme ? 'none' : 'block';
  pagesCheckbox.disabled = !hasReadme;
  if(!hasReadme) pagesCheckbox.checked = false;
}

async function doCreateRepo(){
  const name = document.getElementById('new-repo-name').value.trim();
  const desc = document.getElementById('new-repo-desc').value.trim();
  const isPublic = document.getElementById('new-repo-public').checked;
  const withReadme = document.getElementById('new-repo-readme').checked;
  const enablePages = document.getElementById('new-repo-pages').checked;
  if(!name){ showToast('Ingresá un nombre','error'); return; }
  try {
    await api('/user/repos',{ method:'POST', body:JSON.stringify({ name, description:desc, private:!isPublic, auto_init:withReadme }) });

    if(enablePages && isPublic && withReadme){
      // Esperar un momento para que GitHub inicialice el repo antes de activar Pages
      await new Promise(r=>setTimeout(r,2000));
      try {
        await api(`/repos/${USER}/${name}/pages`,{
          method:'POST',
          body:JSON.stringify({ source:{ branch:'main', path:'/' } })
        });
        showToast('Repositorio "'+name+'" creado con GitHub Pages activo ✅','success');
      } catch(pe){
        showToast('Repo creado, pero Pages falló: '+pe.message,'error');
      }
    } else {
      showToast('Repositorio "'+name+'" creado'+(withReadme?' con README':' sin README'),'success');
    }

    closeModal('new-repo-modal');
    await loadRepos();
    openRepo(name);
  } catch(e){ showToast('Error: '+e.message,'error'); }
}

let newFileRepo='', newFilePath='';
let newFileValidateTimer;

/* ── EDITOR DE LÍNEAS (estilo Notepad++) ── */
function updateLineNumbers(textareaId, gutterId){
  const ta = document.getElementById(textareaId);
  const gutter = document.getElementById(gutterId);
  if(!ta || !gutter) return;
  const lineCount = ta.value.split('\n').length;
  let out = '';
  for(let i=1;i<=lineCount;i++) out += i + (i<lineCount ? '\n' : '');
  gutter.textContent = out;
}

function initCodeEditor(textareaId, gutterId){
  const ta = document.getElementById(textareaId);
  const gutter = document.getElementById(gutterId);
  if(!ta || !gutter) return;
  updateLineNumbers(textareaId, gutterId);
  ta.addEventListener('scroll', ()=>{ gutter.scrollTop = ta.scrollTop; });
  ta.addEventListener('keydown', handleEditorKeydown);
  createEditorSearchBar(ta);
}

/* ── BUSCADOR DENTRO DEL EDITOR ── */
function createEditorSearchBar(ta){
  const wrap = ta.closest('.code-editor-wrap');
  if(!wrap || wrap.querySelector('.code-editor-search')) return; // ya existe, no duplicar

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'code-editor-search-toggle';
  toggleBtn.title = 'Buscar en este archivo (Ctrl+F)';
  toggleBtn.textContent = '🔍';

  const bar = document.createElement('div');
  bar.className = 'code-editor-search';
  bar.innerHTML = `
    <input type="text" placeholder="Buscar en el archivo..." />
    <span class="code-editor-search-count">0/0</span>
    <button type="button" title="Anterior (Shift+Enter)">▲</button>
    <button type="button" title="Siguiente (Enter)">▼</button>
    <button type="button" title="Cerrar (Esc)">✕</button>
  `;
  wrap.appendChild(toggleBtn);
  wrap.appendChild(bar);

  const input = bar.querySelector('input');
  const countEl = bar.querySelector('.code-editor-search-count');
  const [prevBtn, nextBtn, closeBtn] = bar.querySelectorAll('button');
  const state = { matches: [], current: -1 };

  function recompute(){
    const term = input.value;
    state.matches = [];
    if(term){
      const text = ta.value.toLowerCase();
      const needle = term.toLowerCase();
      let idx = text.indexOf(needle);
      while(idx !== -1){
        state.matches.push(idx);
        idx = text.indexOf(needle, idx + needle.length);
      }
    }
    state.current = state.matches.length ? 0 : -1;
    updateCount();
  }

  function updateCount(){
    countEl.textContent = state.matches.length ? `${state.current+1}/${state.matches.length}` : '0/0';
  }

  function goTo(i){
    if(!state.matches.length) return;
    state.current = ((i % state.matches.length) + state.matches.length) % state.matches.length;
    const start = state.matches[state.current];
    const end = start + input.value.length;
    ta.focus();
    ta.setSelectionRange(start, end);
    scrollSelectionIntoView(ta, start);
    updateCount();
  }

  function openBar(){
    bar.style.display = 'flex';
    toggleBtn.style.display = 'none';
    input.focus();
    input.select();
    recompute();
  }

  function closeBar(){
    bar.style.display = 'none';
    toggleBtn.style.display = '';
    ta.focus();
  }

  toggleBtn.addEventListener('click', openBar);
  closeBtn.addEventListener('click', closeBar);
  nextBtn.addEventListener('click', ()=>goTo(state.current+1));
  prevBtn.addEventListener('click', ()=>goTo(state.current-1));
  input.addEventListener('input', ()=>{ recompute(); if(state.matches.length) goTo(0); });
  input.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){ e.preventDefault(); goTo(state.current + (e.shiftKey ? -1 : 1)); }
    else if(e.key === 'Escape'){ e.preventDefault(); closeBar(); }
  });

  // Ctrl+F / Cmd+F con el foco en el editor abre este buscador en vez del buscador del navegador
  ta.addEventListener('keydown', (e)=>{
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f'){
      e.preventDefault();
      openBar();
    }
  });
}

/* Hace scroll dentro del textarea para que la línea encontrada quede visible */
function scrollSelectionIntoView(ta, charIndex){
  const before = ta.value.slice(0, charIndex);
  const line = before.split('\n').length - 1;
  const lineHeight = 20; // debe coincidir con line-height de .code-editor-textarea
  const target = line * lineHeight;
  if(target < ta.scrollTop || target > ta.scrollTop + ta.clientHeight - lineHeight){
    ta.scrollTop = Math.max(0, target - ta.clientHeight / 2);
  }
}

/* Pares que se autocompletan al escribir el caracter de apertura */
const EDITOR_OPEN_TO_CLOSE = { '(':')', '[':']', '{':'}', '"':'"', "'":"'" };
const EDITOR_CLOSERS = ')]}';

function handleEditorKeydown(e){
  const ta = e.target;

  /* Tab → insertar una tabulación real (2 espacios) en vez de sacar el foco */
  if(e.key === 'Tab'){
    e.preventDefault();
    const start = ta.selectionStart, end = ta.selectionEnd;
    ta.value = ta.value.slice(0,start) + '  ' + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + 2;
    ta.dispatchEvent(new Event('input'));
    return;
  }

  /* Enter → mantener indentación de la línea actual, aumentarla si se abrió
     un corchete/llave/paréntesis, y expandir en 3 líneas si el cursor está
     justo entre un par recién abierto (ej: "[|]" -> salto + tabulación + "]") */
  if(e.key === 'Enter'){
    const start = ta.selectionStart, end = ta.selectionEnd;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const currentLine = before.slice(before.lastIndexOf('\n')+1);
    let indent = (currentLine.match(/^[ \t]*/) || [''])[0];

    const prevChar = before.slice(-1);
    const nextChar = after.slice(0,1);

    if(EDITOR_OPEN_TO_CLOSE[prevChar] === nextChar && '([{'.includes(prevChar)){
      e.preventDefault();
      const innerIndent = indent + '  ';
      const insertion = '\n' + innerIndent + '\n' + indent;
      ta.value = before + insertion + after;
      ta.selectionStart = ta.selectionEnd = start + 1 + innerIndent.length;
      ta.dispatchEvent(new Event('input'));
      return;
    }

    if('([{'.includes(prevChar)) indent += '  ';

    e.preventDefault();
    const insertion = '\n' + indent;
    ta.value = before + insertion + after;
    ta.selectionStart = ta.selectionEnd = start + insertion.length;
    ta.dispatchEvent(new Event('input'));
    return;
  }

  /* Si el cursor ya está justo antes del cierre y el usuario lo vuelve a
     escribir a mano, saltarlo en vez de duplicarlo */
  if((EDITOR_CLOSERS.includes(e.key) || e.key === '"' || e.key === "'") &&
     ta.selectionStart === ta.selectionEnd &&
     ta.value[ta.selectionStart] === e.key){
    e.preventDefault();
    ta.selectionStart = ta.selectionEnd = ta.selectionStart + 1;
    return;
  }

  /* Autocompletar el cierre al escribir un caracter de apertura
     (envuelve la selección si había texto seleccionado) */
  const close = EDITOR_OPEN_TO_CLOSE[e.key];
  if(close){
    const start = ta.selectionStart, end = ta.selectionEnd;
    e.preventDefault();
    if(start !== end){
      const selected = ta.value.slice(start, end);
      ta.value = ta.value.slice(0,start) + e.key + selected + close + ta.value.slice(end);
      ta.selectionStart = start + 1;
      ta.selectionEnd = start + 1 + selected.length;
    } else {
      ta.value = ta.value.slice(0,start) + e.key + close + ta.value.slice(start);
      ta.selectionStart = ta.selectionEnd = start + 1;
    }
    ta.dispatchEvent(new Event('input'));
  }
}

function openNewFileModal(repo, path){
  newFileRepo=repo; newFilePath=path;
  document.getElementById('new-file-name').value='';
  document.getElementById('new-file-content').value='';
  document.getElementById('new-file-json-status').innerHTML='';
  document.getElementById('new-file-content').style.borderColor='';
  document.getElementById('new-file-create-btn').disabled=false;
  updateLineNumbers('new-file-content','new-file-gutter');
  document.getElementById('new-file-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(()=>document.getElementById('new-file-name').focus(),100);
}

function onNewFileNameOrContentChange(){
  updateLineNumbers('new-file-content','new-file-gutter');
  clearTimeout(newFileValidateTimer);
  newFileValidateTimer = setTimeout(validateNewFileJson, 150);
}

/* Convierte una posición de caracter en línea/columna, para señalar dónde está el error */
function posToLineCol(str, pos){
  const lines = str.slice(0, pos).split('\n');
  return { line: lines.length, col: lines[lines.length-1].length + 1 };
}

/* Traduce al español los mensajes típicos de JSON.parse (el motor del navegador
   los devuelve siempre en inglés). Si no reconoce el patrón, devuelve un mensaje
   genérico en español en vez de mostrar texto en inglés. */
function translateJsonError(message){
  const patterns = [
    [/Unexpected end of JSON input/i, ()=>'Fin de JSON inesperado (¿falta cerrar una llave, corchete o comilla?)'],
    [/Unexpected non-whitespace character after JSON/i, ()=>'Sobra contenido después de un JSON que ya estaba completo'],
    [/Expected ',' or '\]' after array element/i, ()=>"Falta una coma, o falta cerrar el arreglo con ']', después de un elemento"],
    [/Expected ',' or '}' after property value/i, ()=>"Falta una coma, o falta cerrar el objeto con '}', después del valor de una propiedad"],
    [/Expected double-quoted property name/i, ()=>'Falta el nombre de una propiedad entre comillas dobles (¿falta una coma antes?)'],
    [/Expected property name or '}'/i, ()=>"Se esperaba el nombre de una propiedad o el cierre '}'"],
    [/Expected ':' after property name/i, ()=>"Falta ':' después del nombre de una propiedad"],
    [/No number after minus sign/i, ()=>'Falta un número después del signo "-"'],
    [/Unterminated string/i, ()=>'Hay una cadena de texto sin cerrar (falta una comilla)'],
    [/Bad control character in string literal/i, ()=>'Hay un caracter de control inválido dentro de una cadena de texto'],
    [/Bad escaped character/i, ()=>'Hay una secuencia de escape inválida (por ejemplo, una barra invertida mal usada)'],
    [/Unexpected identifier/i, ()=>'Se encontró texto que no es válido en JSON (¿faltan comillas en un valor?)'],
    [/Unexpected token '?(.+?)'? in JSON/i, (m)=>`Caracter inesperado "${m[1]}" en el JSON`],
    [/Unexpected token '?(.+?)'?,/i, (m)=>`Caracter inesperado "${m[1]}"`],
  ];

  for(const [regex, fn] of patterns){
    const m = message.match(regex);
    if(m) return fn(m);
  }
  return 'Formato de JSON inválido';
}

function validateNewFileJson(){
  const name = document.getElementById('new-file-name').value.trim();
  const content = document.getElementById('new-file-content').value;
  const statusEl = document.getElementById('new-file-json-status');
  const textarea = document.getElementById('new-file-content');
  const createBtn = document.getElementById('new-file-create-btn');
  const isJson = /\.json$/i.test(name);

  if(!isJson){
    statusEl.innerHTML = '';
    textarea.style.borderColor = '';
    createBtn.disabled = false;
    return;
  }

  if(!content.trim()){
    statusEl.innerHTML = '<span style="color:var(--muted);">Sin contenido todavía — se creará un archivo .json vacío</span>';
    textarea.style.borderColor = '';
    createBtn.disabled = false;
    return;
  }

  try {
    JSON.parse(content);
    statusEl.innerHTML = '<span style="color:var(--accent);">✅ JSON válido</span>';
    textarea.style.borderColor = 'var(--accent)';
    createBtn.disabled = false;
  } catch(e){
    const posMatch = e.message.match(/position (\d+)/);
    let where = '';
    if(posMatch){
      const { line, col } = posToLineCol(content, parseInt(posMatch[1],10));
      where = ` (línea ${line}, columna ${col})`;
    }
    statusEl.innerHTML = `<span style="color:var(--red);">❌ Error de sintaxis${where}: ${escapeHtml(translateJsonError(e.message))}</span>`;
    textarea.style.borderColor = 'var(--red)';
    createBtn.disabled = true;
  }
}

function utf8ToBase64(str){
  return btoa(unescape(encodeURIComponent(str)));
}

async function doCreateFile(){
  const name = document.getElementById('new-file-name').value.trim().replace(/^\/+/,'');
  if(!name){ showToast('Ingresá un nombre de archivo','error'); return; }
  const content = document.getElementById('new-file-content').value;

  if(/\.json$/i.test(name) && content.trim()){
    try { JSON.parse(content); }
    catch(e){ showToast('El JSON tiene errores de sintaxis, corregilo antes de crear el archivo','error'); return; }
  }

  const fullPath = newFilePath ? `${newFilePath}/${name}` : name;

  const btn = document.getElementById('new-file-create-btn');
  btn.disabled = true; btn.textContent = 'Creando...';
  try {
    let exists = false;
    try { await api(`/repos/${USER}/${newFileRepo}/contents/${fullPath}`); exists = true; } catch(e){}
    if(exists){
      showToast('Ya existe un archivo con ese nombre. Usá "Subir" si querés reemplazarlo.','error');
      return;
    }
    await api(`/repos/${USER}/${newFileRepo}/contents/${fullPath}`,{
      method:'PUT', body:JSON.stringify({ message:`Create ${name}`, content: utf8ToBase64(content) })
    });
    showToast('Archivo "'+name+'" creado','success');
    closeModal('new-file-modal');
    if(currentRepo===newFileRepo) loadFiles(newFilePath);
  } catch(e){ showToast('Error: '+e.message,'error'); }
  finally { btn.disabled = false; btn.textContent = 'Crear archivo'; }
}

let newFolderRepo='', newFolderPath='';
function openNewFolderModal(repo, path){
  newFolderRepo=repo; newFolderPath=path;
  document.getElementById('new-folder-name').value='';
  document.getElementById('new-folder-modal').classList.add('open');
}

async function doCreateFolder(){
  const name = document.getElementById('new-folder-name').value.trim().replace(/\//g,'');
  if(!name){ showToast('Ingresá un nombre de carpeta','error'); return; }
  const fullPath = newFolderPath ? `${newFolderPath}/${name}/.gitkeep` : `${name}/.gitkeep`;
  try {
    await api(`/repos/${USER}/${newFolderRepo}/contents/${fullPath}`,{
      method:'PUT', body:JSON.stringify({ message:`Create folder ${name}`, content:btoa('') })
    });
    showToast('Carpeta "'+name+'" creada','success');
    closeModal('new-folder-modal');
    if(currentRepo===newFolderRepo) loadFiles(newFolderPath);
  } catch(e){ showToast('Error: '+e.message,'error'); }
}

let repoToDelete='';
function openDelRepoModal(name){
  repoToDelete=name;
  document.getElementById('del-repo-confirm').value='';
  document.getElementById('del-repo-confirm').placeholder=name;
  document.getElementById('del-repo-modal').classList.add('open');
}

async function doDeleteRepo(){
  const confirm_name = document.getElementById('del-repo-confirm').value.trim();
  if(confirm_name!==repoToDelete){ showToast('El nombre no coincide','error'); return; }
  try {
    await api(`/repos/${USER}/${repoToDelete}`,{ method:'DELETE' });
    showToast('Repositorio "'+repoToDelete+'" eliminado','success');
    closeModal('del-repo-modal');
    currentRepo=null; currentPath='';
    await loadRepos();
    document.getElementById('main-content').innerHTML='<div class="empty-state"><p>Seleccioná un repositorio</p></div>';
  } catch(e){ showToast('Error: '+e.message+'. Verificá el permiso delete_repo','error'); }
}

/* ── GISTS ── */
async function loadGists(){
  const container = document.getElementById('gists-list');
  container.innerHTML = '<div class="loading"><div class="spinner"></div>Cargando gists...</div>';
  try {
    ALL_GISTS = await api('/gists?per_page=100');
    renderGists(ALL_GISTS);
  } catch(e){
    container.innerHTML = '<div class="loading">Error: '+e.message+'. Verificá que el token tenga permiso <code>gist</code></div>';
  }
}

function filterGists(){
  const q = document.getElementById('gist-search-input').value.toLowerCase();
  if(!q){ renderGists(ALL_GISTS); return; }
  const filtered = ALL_GISTS.filter(g=>{
    const descMatch = (g.description||'').toLowerCase().includes(q);
    const fileMatch = Object.keys(g.files).some(f=>f.toLowerCase().includes(q));
    return descMatch || fileMatch;
  });
  renderGists(filtered);
}

function renderGists(gists){
  const container = document.getElementById('gists-list');
  if(!gists.length){
    container.innerHTML = '<div class="empty-state"><p>No se encontraron gists</p></div>';
    return;
  }
  container.innerHTML = gists.map(g=>{
    const files = Object.values(g.files);
    const updatedDate = new Date(g.updated_at).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'});
    const fileCount = files.length;
    return `
    <div class="gist-card">
      <div class="gist-header">
        <div class="gist-meta">
          <div class="gist-desc ${g.description?'':'no-desc'}">${g.description || 'Sin descripción'}</div>
          <div class="gist-info">
            <span class="gist-vis-badge ${g.public?'public':'secret'}">${g.public?'🌐 Público':'🔒 Secreto'}</span>
            <span>📄 ${fileCount} archivo${fileCount!==1?'s':''}</span>
            <span>🕐 Actualizado ${updatedDate}</span>
          </div>
        </div>
        <div class="gist-actions">
          <button class="btn" style="font-size:12px;padding:5px 10px;" onclick="window.open('${g.html_url}','_blank')" title="Ver en GitHub">👁️ Ver</button>
          <button class="btn btn-blue" style="font-size:12px;padding:5px 10px;" onclick="openEditGistModal('${g.id}')" title="Editar">✏️ Editar</button>
          <button class="btn btn-red" style="font-size:12px;padding:5px 10px;" onclick="openDelGistModal('${g.id}')" title="Eliminar">🗑️</button>
        </div>
      </div>
      <div class="gist-files">
        ${files.map(f=>{
          const rawUrl = `https://gist.githubusercontent.com/${USER}/${g.id}/raw/${f.filename}`;
          return `
          <div class="gist-file-row">
            <span class="gist-file-name">📄 ${f.filename}</span>
            <span class="gist-file-url" title="${rawUrl}">${rawUrl}</span>
            <button class="copy-btn" onclick="copyUrl('${rawUrl}',this)">Copiar URL</button>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

/* ── MODAL CREAR/EDITAR GIST ── */
let gistFileCount = 0;
let gistValidateTimers = {};

function addGistFileRow(name='', content=''){
  gistFileCount++;
  const id = 'gf-'+gistFileCount;
  const editor = document.getElementById('gist-file-editor');
  const row = document.createElement('div');
  row.className = 'gist-file-editor-row';
  row.id = id;
  row.innerHTML = `
    <input type="text" class="file-editor-name" placeholder="nombre-archivo.json" value="${escapeAttr(name)}" style="flex:0 0 200px;" oninput="scheduleGistValidation('${id}')" />
    <div style="flex:1;min-width:0;">
      <div class="gist-json-status" id="${id}-status" style="font-size:13px;margin-bottom:4px;min-height:16px;"></div>
      <div class="code-editor-wrap">
        <div class="code-editor-gutter" id="${id}-gutter">1</div>
        <textarea class="code-editor-textarea file-editor-content" id="${id}-content" placeholder="Contenido del archivo..." spellcheck="false" oninput="scheduleGistValidation('${id}')">${escapeHtml(content)}</textarea>
      </div>
    </div>
    <button class="remove-file-btn" onclick="removeGistFileRow('${id}')" title="Quitar archivo">✕</button>
  `;
  editor.appendChild(row);
  initCodeEditor(id+'-content', id+'-gutter');
  validateGistFileRow(id); // valida de inmediato por si ya trae contenido (ej. al editar un gist existente)
}

function removeGistFileRow(id){
  const el = document.getElementById(id);
  if(el) el.remove();
  updateGistSaveButtonState();
}

function scheduleGistValidation(id){
  updateLineNumbers(id+'-content', id+'-gutter');
  clearTimeout(gistValidateTimers[id]);
  gistValidateTimers[id] = setTimeout(()=>validateGistFileRow(id), 150);
}

function validateGistFileRow(id){
  const row = document.getElementById(id);
  if(!row) return;
  const nameEl = row.querySelector('.file-editor-name');
  const contentEl = row.querySelector('.file-editor-content');
  const statusEl = document.getElementById(id+'-status');
  const name = nameEl.value.trim();
  const content = contentEl.value;
  const isJson = /\.json$/i.test(name);

  row.classList.remove('row-invalid');

  if(!isJson){
    if(statusEl) statusEl.innerHTML = '';
    contentEl.style.borderColor = '';
    updateGistSaveButtonState();
    return;
  }

  if(!content.trim()){
    if(statusEl) statusEl.innerHTML = '<span style="color:var(--muted);">Sin contenido todavía</span>';
    contentEl.style.borderColor = '';
    updateGistSaveButtonState();
    return;
  }

  try {
    JSON.parse(content);
    if(statusEl) statusEl.innerHTML = '<span style="color:var(--accent);">✅ JSON válido</span>';
    contentEl.style.borderColor = 'var(--accent)';
  } catch(e){
    const posMatch = e.message.match(/position (\d+)/);
    let where = '';
    if(posMatch){
      const { line, col } = posToLineCol(content, parseInt(posMatch[1],10));
      where = ` (línea ${line}, columna ${col})`;
    }
    if(statusEl) statusEl.innerHTML = `<span style="color:var(--red);">❌ Error de sintaxis${where}: ${escapeHtml(translateJsonError(e.message))}</span>`;
    contentEl.style.borderColor = 'var(--red)';
    row.classList.add('row-invalid');
  }
  updateGistSaveButtonState();
}

function updateGistSaveButtonState(){
  const btn = document.getElementById('gist-save-btn');
  if(!btn) return;
  const hasInvalid = document.querySelectorAll('#gist-file-editor .gist-file-editor-row.row-invalid').length > 0;
  btn.disabled = hasInvalid;
  btn.title = hasInvalid ? 'Corregí los errores de JSON antes de guardar' : '';
}

function escapeHtml(str){ return (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escapeAttr(str){ return (str||'').replace(/"/g,'&quot;'); }

function openGistModal(){
  editingGistId = null;
  document.getElementById('gist-modal-title').textContent = '📝 Nuevo Gist';
  document.getElementById('gist-desc').value = '';
  document.getElementById('gist-public').checked = true;
  document.getElementById('gist-file-editor').innerHTML = '';
  gistFileCount = 0;
  addGistFileRow('nuevo-archivo.json', '');
  updateGistSaveButtonState();
  document.getElementById('gist-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

async function openEditGistModal(gistId){
  editingGistId = gistId;
  document.getElementById('gist-modal-title').textContent = '✏️ Editar Gist';
  document.getElementById('gist-file-editor').innerHTML = '';
  gistFileCount = 0;

  try {
    const g = await api('/gists/'+gistId);
    document.getElementById('gist-desc').value = g.description || '';
    document.getElementById('gist-public').checked = g.public;
    Object.values(g.files).forEach(f=>{ addGistFileRow(f.filename, f.content||''); });
    updateGistSaveButtonState();
    document.getElementById('gist-modal').classList.add('open');
    document.body.style.overflow = 'hidden';
  } catch(e){ showToast('Error cargando gist: '+e.message,'error'); }
}

async function saveGist(){
  const desc = document.getElementById('gist-desc').value.trim();
  const isPublic = document.getElementById('gist-public').checked;
  const rows = document.getElementById('gist-file-editor').querySelectorAll('.gist-file-editor-row');
  const files = {};
  let valid = true;
  rows.forEach(row=>{
    const nameEl = row.querySelector('.file-editor-name');
    const contentEl = row.querySelector('.file-editor-content');
    const name = nameEl.value.trim();
    const content = contentEl.value;
    if(!name){ nameEl.style.borderColor='var(--red)'; valid=false; return; }
    nameEl.style.borderColor='';
    if(/\.json$/i.test(name) && content.trim()){
      try { JSON.parse(content); }
      catch(e){ valid=false; contentEl.style.borderColor='var(--red)'; return; }
    }
    files[name] = { content: content || ' ' };
  });
  if(!valid){ showToast('Revisá los archivos: falta un nombre o hay JSON con errores de sintaxis','error'); return; }
  if(!Object.keys(files).length){ showToast('Agregá al menos un archivo','error'); return; }

  const btn = document.getElementById('gist-save-btn');
  btn.textContent = 'Guardando...'; btn.disabled = true;

  try {
    if(editingGistId){
      await api('/gists/'+editingGistId,{ method:'PATCH', body:JSON.stringify({ description:desc, files }) });
      showToast('Gist actualizado','success');
    } else {
      await api('/gists',{ method:'POST', body:JSON.stringify({ description:desc, public:isPublic, files }) });
      showToast('Gist creado','success');
    }
    closeModal('gist-modal');
    ALL_GISTS = [];
    await loadGists();
  } catch(e){
    if(e.message === 'Not Found'){
      showToast('Error: tu token no tiene permiso para Gists. Generá un token clásico (no fine-grained) en github.com/settings/tokens con el checkbox "gist" marcado.','error');
    } else {
      showToast('Error: '+e.message,'error');
    }
  }
  finally { btn.textContent='Guardar Gist'; btn.disabled=false; }
}

function openDelGistModal(gistId){
  gistToDelete = gistId;
  const g = ALL_GISTS.find(x=>x.id===gistId);
  document.getElementById('del-gist-desc').textContent = g ? (g.description || 'Sin descripción') : gistId;
  document.getElementById('del-gist-modal').classList.add('open');
}

async function doDeleteGist(){
  try {
    await api('/gists/'+gistToDelete,{ method:'DELETE' });
    showToast('Gist eliminado','success');
    closeModal('del-gist-modal');
    ALL_GISTS = ALL_GISTS.filter(g=>g.id!==gistToDelete);
    renderGists(ALL_GISTS);
  } catch(e){ showToast('Error: '+e.message,'error'); }
}

/* ── UTILS ── */
function closeModal(id){ document.getElementById(id).classList.remove('open'); document.body.style.overflow = ''; }

let toastTimer;
function showToast(msg, type=''){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className='toast show '+type;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.className='toast',3500);
}

/* ── RENOMBRAR ── */
let renameType='', renamePath='', renameOldName='', renameSha='';

function openRenameModal(type, path, oldName, sha=''){
  renameType=type; renamePath=path; renameOldName=oldName; renameSha=sha;
  document.getElementById('rename-modal-title').textContent = type==='folder' ? '🏷️ Renombrar carpeta' : '🏷️ Renombrar archivo';
  document.getElementById('rename-modal-hint').textContent = 'Nombre actual: ' + oldName;
  document.getElementById('rename-input').value = oldName;
  document.getElementById('rename-modal').classList.add('open');
  setTimeout(()=>{ const el=document.getElementById('rename-input'); el.focus(); el.select(); },100);
}

async function doRename(){
  const newName = document.getElementById('rename-input').value.trim();
  if(!newName){ showToast('Ingresá un nombre','error'); return; }
  if(newName === renameOldName){ closeModal('rename-modal'); return; }

  const parentDir = renamePath.split('/').slice(0,-1).join('/');
  const newPath = parentDir ? parentDir+'/'+newName : newName;

  try {
    if(renameType === 'file'){
      // Archivos: descargar contenido, crear con nuevo nombre, borrar el viejo
      const fileData = await api(`/repos/${USER}/${currentRepo}/contents/${renamePath}`);
      await api(`/repos/${USER}/${currentRepo}/contents/${newPath}`,{
        method:'PUT',
        body:JSON.stringify({ message:`Rename ${renameOldName} to ${newName}`, content:fileData.content.replace(/\n/g,'') })
      });
      await api(`/repos/${USER}/${currentRepo}/contents/${renamePath}`,{
        method:'DELETE',
        body:JSON.stringify({ message:`Remove old ${renameOldName}`, sha:fileData.sha })
      });
      showToast('Archivo renombrado a "'+newName+'"','success');

    } else {
      // Carpetas: mover todos los archivos dentro a la nueva ruta
      const items = await api(`/repos/${USER}/${currentRepo}/contents/${renamePath}`);
      const filesToMove = Array.isArray(items) ? items.filter(i=>i.type==='file') : [];
      for(const item of filesToMove){
        const fileData = await api(`/repos/${USER}/${currentRepo}/contents/${item.path}`);
        const destPath = newPath+'/'+item.name;
        await api(`/repos/${USER}/${currentRepo}/contents/${destPath}`,{
          method:'PUT',
          body:JSON.stringify({ message:`Move ${item.name} to ${newName}/`, content:fileData.content.replace(/\n/g,'') })
        });
        await api(`/repos/${USER}/${currentRepo}/contents/${item.path}`,{
          method:'DELETE',
          body:JSON.stringify({ message:`Remove old ${item.path}`, sha:fileData.sha })
        });
      }
      showToast('Carpeta renombrada a "'+newName+'"','success');
    }
    closeModal('rename-modal');
    loadFiles(currentPath);
  } catch(e){ showToast('Error al renombrar: '+e.message,'error'); }
}

window.addEventListener('click',e=>{ if(e.target.classList.contains('modal-bg')){ e.target.classList.remove('open'); document.body.style.overflow = ''; } });
window.addEventListener('keydown',e=>{ if(e.key==='Enter' && document.getElementById('rename-modal').classList.contains('open')) doRename(); });

initCodeEditor('new-file-content','new-file-gutter'); // sincroniza scroll gutter/textarea del modal "Crear archivo"

(function init(){
  const t=load('gh_token'), u=load('gh_user');
  if(t&&u){ TOKEN=t; USER=u; startApp(); }
})();
